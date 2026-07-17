// React orchestration for the approval scanner: scan state, and the revoke
// state machine. Chain-agnostic - it talks to whichever lane the registry
// returns and never imports a chain module directly, so an EVM lane needs no
// change here.
//
// THE REVOKE STATE MACHINE
//
//   idle
//     -> requestRevoke(approval)   [user clicked Revoke on one row]
//   preparing                      [building + pricing + simulating; no prompt]
//     -> confirm                   [dialog shows the REAL fee and the exact target]
//     -> error                     [could not build a sendable transaction]
//   confirm
//     -> confirmRevoke()           [user explicitly confirmed]
//     -> cancelRevoke()            [-> idle, nothing sent]
//   signing                        [wallet popup open; user may still decline]
//     -> success | rejected | error
//   success
//     -> automatic re-scan, then the row is gone
//
// Two rules this encodes, both from the brief and both load-bearing:
//
//   1. NOTHING IS EVER REVOKED AUTOMATICALLY. Every transition out of `idle` and
//      out of `confirm` is a distinct, deliberate user action. There is no
//      "revoke all", no retry-on-failure that re-sends, and no code path that
//      reaches confirmRevoke() without a human having read the dialog.
//   2. The transaction the user approves is the transaction that gets sent -
//      prepared once, held, and handed to the lane unchanged.
//
// `rejected` is a first-class outcome, not an error: declining in the wallet is
// a legitimate answer to "shall I sign this?" and must not be rendered in red as
// though something broke.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { laneFor } from './index.js';
import { classifyAll, summarizeApprovals } from './approvalEngine.js';
import { trackEvent } from '../platformAnalytics.js';

const IDLE_REVOKE = { phase: 'idle', approval: null, prepared: null, feeLamports: null, signature: '', message: '' };

export function useApprovalScanner({ chain = 'solana', connection, publicKey, sendTransaction, tokenLookup }) {
  const [scanState, setScanState] = useState('idle'); // idle | scanning | ready | error
  const [approvals, setApprovals] = useState([]);
  const [scanError, setScanError] = useState('');
  const [lastScanAt, setLastScanAt] = useState(null);
  const [revoke, setRevoke] = useState(IDLE_REVOKE);

  const lane = laneFor(chain);
  const address = publicKey?.toString() || '';

  // Guards every setState that follows an await. Without this, disconnecting a
  // wallet mid-scan resolves the old request into the new (empty) view and shows
  // one wallet's approvals under another's address.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Identifies the scan a result belongs to. A scan started for wallet A must
  // not populate the list after the user has switched to wallet B, even though
  // both requests are in flight against the same hook instance.
  const scanToken = useRef(0);

  // Mirrors `revoke` so confirmRevoke can read the live phase without a stale
  // closure and without reading state from inside a setState updater (see the
  // note in confirmRevoke - that pattern double-fires under StrictMode).
  const revokeRef = useRef(IDLE_REVOKE);
  useEffect(() => {
    revokeRef.current = revoke;
  }, [revoke]);

  const runScan = useCallback(
    async ({ silent = false } = {}) => {
      if (!lane || !connection || !publicKey) {
        setApprovals([]);
        setScanState('idle');
        return;
      }
      const ticket = ++scanToken.current;
      if (!silent) setScanState('scanning');
      setScanError('');

      const result = await lane.scan({ connection, publicKey, tokenLookup });

      if (!mounted.current || ticket !== scanToken.current) return;

      if (!result.ok) {
        // Never present a failed scan as a clean wallet - see the note in
        // solanaLane.scan().
        setScanState('error');
        setScanError(result.message || result.status || 'scan_failed');
        setApprovals([]);
        return;
      }

      const classified = classifyAll(result.approvals);
      setApprovals(classified);
      setScanState('ready');
      setLastScanAt(new Date().toISOString());

      const summary = summarizeApprovals(classified);
      trackEvent('approval_scan', {
        chain,
        approvalCount: summary.total,
        highRiskCount: summary.high,
        liveExposureCount: summary.liveExposureCount,
      });
    },
    [lane, connection, publicKey, tokenLookup, chain]
  );

  // Scan when a wallet connects, and re-scan when the wallet CHANGES. Keyed on
  // the address rather than the publicKey object, which is a new instance on
  // every adapter render and would loop.
  useEffect(() => {
    if (!address) {
      setApprovals([]);
      setScanState('idle');
      setRevoke(IDLE_REVOKE);
      return;
    }
    runScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, chain]);

  // Step 1: build, price and simulate. Opens no wallet popup - the user has not
  // agreed to anything yet, and must not be asked to sign something they have
  // not been shown.
  const requestRevoke = useCallback(
    async (approval) => {
      if (!lane || !approval) return;
      setRevoke({ ...IDLE_REVOKE, phase: 'preparing', approval });

      const prepared = await lane.prepareRevoke({ connection, publicKey, approval });
      if (!mounted.current) return;

      if (!prepared.ok) {
        setRevoke({
          ...IDLE_REVOKE,
          phase: 'error',
          approval,
          message: prepared.message || prepared.status || 'prepare_failed',
        });
        return;
      }

      setRevoke({
        phase: 'confirm',
        approval,
        prepared,
        feeLamports: prepared.feeLamports,
        signature: '',
        message: '',
      });
    },
    [lane, connection, publicKey]
  );

  // Step 2: the user has read the dialog and explicitly confirmed. Only now does
  // the wallet get asked to sign.
  const confirmRevoke = useCallback(async () => {
    if (!lane) return;

    // Read the current phase from the ref, never by reaching into a setState
    // updater. An updater must be pure - React may invoke it twice (StrictMode
    // does exactly this in development), and a version of this that captured
    // state from inside the updater would fire the guard twice and could send
    // the transaction twice. For a security action that costs a fee, "sends
    // twice under StrictMode" is not an acceptable failure mode.
    const current = revokeRef.current;

    // The send is structurally reachable only from `confirm`: a stray call, a
    // double-click, or a future refactor cannot skip the dialog. A second click
    // finds phase === 'signing' and returns.
    if (current.phase !== 'confirm' || !current.prepared) return;
    setRevoke((state) => ({ ...state, phase: 'signing', message: '' }));

    const result = await lane.executeRevoke({ connection, sendTransaction, prepared: current.prepared });
    if (!mounted.current) return;

    if (!result.ok) {
      setRevoke((state) => ({
        ...state,
        phase: result.status === 'rejected' ? 'rejected' : 'error',
        message: result.message || result.status || '',
      }));
      trackEvent('approval_revoke_failed', {
        chain,
        status: result.status,
        tokenAddress: current.approval?.tokenAddress || '',
      });
      return;
    }

    setRevoke((state) => ({ ...state, phase: 'success', signature: result.signature, message: '' }));
    trackEvent('approval_revoked', {
      chain,
      tokenAddress: current.approval?.tokenAddress || '',
      spender: current.approval?.spender || '',
      risk: current.approval?.risk || '',
    });

    // Re-scan so the list reflects the chain rather than an assumption that the
    // revoke landed. Silent: the success panel stays on screen instead of the
    // whole page dropping back to a spinner. If the revoke somehow did not take
    // effect, the row reappears - which is the truth, and better than optimistic
    // removal that would tell the user they are safe when they are not.
    await runScan({ silent: true });
  }, [lane, connection, sendTransaction, runScan, chain]);

  const cancelRevoke = useCallback(() => setRevoke(IDLE_REVOKE), []);

  const summary = useMemo(() => summarizeApprovals(approvals), [approvals]);

  return {
    supported: Boolean(lane),
    scanState,
    scanError,
    approvals,
    summary,
    lastScanAt,
    rescan: runScan,
    revoke,
    requestRevoke,
    confirmRevoke,
    cancelRevoke,
  };
}
