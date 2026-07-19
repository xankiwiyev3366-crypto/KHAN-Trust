// Self-contained QR Code generator — no external dependency, no network, no
// third-party image service (which would leak every invite link to a stranger
// and break under the app's CSP). Faithful, compact port of Nayuki's
// "QR Code generator library" (public domain,
// https://www.nayuki.io/page/qr-code-generator-library), trimmed to the byte
// (UTF-8) mode this app needs for referral URLs, plus an SVG renderer.
//
// Public API:
//   qrToSvg(text, { ecc='M', border=4, scale=8, dark, light }) -> SVG string
//   encodeQr(text, ecc)  -> { size, getModule(x,y) }   (lower level)

// ── Error-correction levels ───────────────────────────────────────────────────
const ECC = {
  L: { ordinal: 0, formatBits: 1 },
  M: { ordinal: 1, formatBits: 0 },
  Q: { ordinal: 2, formatBits: 3 },
  H: { ordinal: 3, formatBits: 2 },
};

// Per-version, per-ECC tables from the QR Code spec (indexes 1..40; index 0 is
// an unused placeholder so version N reads at table[N]).
const ECC_CODEWORDS_PER_BLOCK = [
  // L, M, Q, H  (row = ecc ordinal)
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const NUM_ERROR_CORRECTION_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

const MIN_VERSION = 1;
const MAX_VERSION = 40;

function getNumRawDataModules(ver) {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

function getNumDataCodewords(ver, eccOrdinal) {
  return (
    Math.floor(getNumRawDataModules(ver) / 8) -
    ECC_CODEWORDS_PER_BLOCK[eccOrdinal][ver] * NUM_ERROR_CORRECTION_BLOCKS[eccOrdinal][ver]
  );
}

// ── Reed-Solomon over GF(256) ─────────────────────────────────────────────────
function reedSolomonComputeDivisor(degree) {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = reedSolomonMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = reedSolomonMultiply(root, 0x02);
  }
  return result;
}

function reedSolomonComputeRemainder(data, divisor) {
  const result = new Uint8Array(divisor.length);
  for (const b of data) {
    const factor = b ^ result[0];
    result.copyWithin(0, 1);
    result[result.length - 1] = 0;
    for (let i = 0; i < result.length; i++) {
      result[i] ^= reedSolomonMultiply(divisor[i], factor);
    }
  }
  return result;
}

function reedSolomonMultiply(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

// ── Bit buffer ────────────────────────────────────────────────────────────────
function appendBits(val, len, bb) {
  for (let i = len - 1; i >= 0; i--) bb.push((val >>> i) & 1);
}

// ── Encoding ──────────────────────────────────────────────────────────────────
function toUtf8Bytes(str) {
  return Array.from(new TextEncoder().encode(str));
}

// Byte (8-bit) segment: mode indicator 0100, char-count field, then the bytes.
function makeByteSegment(data) {
  const bits = [];
  for (const b of data) appendBits(b, 8, bits);
  return { numChars: data.length, bitData: bits };
}

function charCountBits(ver) {
  // Byte mode: 8 bits for versions 1-9, 16 for 10-40.
  return ver <= 9 ? 8 : 16;
}

function encodeSegments(bytes, eccKey) {
  const eccOrdinal = ECC[eccKey].ordinal;
  const seg = makeByteSegment(bytes);

  // Smallest version that fits.
  let version = MIN_VERSION;
  let dataUsedBits = 0;
  for (; ; version++) {
    if (version > MAX_VERSION) throw new Error('Data too long for a QR code');
    const dataCapacityBits = getNumDataCodewords(version, eccOrdinal) * 8;
    const ccBits = charCountBits(version);
    const usedBits = 4 + ccBits + seg.bitData.length;
    if (usedBits <= dataCapacityBits) {
      dataUsedBits = usedBits;
      break;
    }
  }

  const dataCapacityBits = getNumDataCodewords(version, eccOrdinal) * 8;
  const bb = [];
  appendBits(0x4, 4, bb); // byte mode indicator
  appendBits(seg.numChars, charCountBits(version), bb);
  for (const bit of seg.bitData) bb.push(bit);

  // Terminator + bit/byte padding + alternating pad bytes.
  appendBits(0, Math.min(4, dataCapacityBits - bb.length), bb);
  appendBits(0, (8 - (bb.length % 8)) % 8, bb);
  for (let padByte = 0xec; bb.length < dataCapacityBits; padByte ^= 0xec ^ 0x11) {
    appendBits(padByte, 8, bb);
  }

  // Bits → data codewords.
  const dataCodewords = new Uint8Array(bb.length / 8);
  for (let i = 0; i < bb.length; i++) {
    dataCodewords[i >>> 3] |= bb[i] << (7 - (i & 7));
  }

  return { version, eccOrdinal, dataCodewords };
}

// Interleave data + Reed-Solomon ECC codewords across blocks.
function addEccAndInterleave(dataCodewords, version, eccOrdinal) {
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[eccOrdinal][version];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[eccOrdinal][version];
  const rawCodewords = Math.floor(getNumRawDataModules(version) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);

  const blocks = [];
  const rsDiv = reedSolomonComputeDivisor(blockEccLen);
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const datLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
    const dat = Array.from(dataCodewords.slice(k, k + datLen));
    k += datLen;
    const ecc = reedSolomonComputeRemainder(dat, rsDiv);
    if (i < numShortBlocks) dat.push(0);
    blocks.push(dat.concat(Array.from(ecc)));
  }

  const result = [];
  for (let i = 0; i < blocks[0].length; i++) {
    for (let j = 0; j < blocks.length; j++) {
      // Skip the trailing padding cell that short blocks share.
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) {
        result.push(blocks[j][i]);
      }
    }
  }
  return result;
}

// ── Matrix drawing ────────────────────────────────────────────────────────────
class QrMatrix {
  constructor(version, eccOrdinal) {
    this.version = version;
    this.size = version * 4 + 17;
    this.eccOrdinal = eccOrdinal;
    this.modules = [];
    this.isFunction = [];
    for (let i = 0; i < this.size; i++) {
      this.modules.push(new Array(this.size).fill(false));
      this.isFunction.push(new Array(this.size).fill(false));
    }
  }

  getModule(x, y) {
    return x >= 0 && x < this.size && y >= 0 && y < this.size && this.modules[y][x];
  }

  setFunctionModule(x, y, isDark) {
    this.modules[y][x] = isDark;
    this.isFunction[y][x] = true;
  }

  drawFunctionPatterns() {
    for (let i = 0; i < this.size; i++) {
      this.setFunctionModule(6, i, i % 2 === 0);
      this.setFunctionModule(i, 6, i % 2 === 0);
    }
    this.drawFinderPattern(3, 3);
    this.drawFinderPattern(this.size - 4, 3);
    this.drawFinderPattern(3, this.size - 4);

    const alignPatPos = this.getAlignmentPatternPositions();
    const numAlign = alignPatPos.length;
    for (let i = 0; i < numAlign; i++) {
      for (let j = 0; j < numAlign; j++) {
        if (!((i === 0 && j === 0) || (i === 0 && j === numAlign - 1) || (i === numAlign - 1 && j === 0))) {
          this.drawAlignmentPattern(alignPatPos[i], alignPatPos[j]);
        }
      }
    }

    this.drawFormatBits(0); // placeholder; overwritten once mask is chosen
    this.drawVersion();
  }

  drawFinderPattern(x, y) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) {
          this.setFunctionModule(xx, yy, dist !== 2 && dist !== 4);
        }
      }
    }
  }

  drawAlignmentPattern(x, y) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        this.setFunctionModule(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  getAlignmentPatternPositions() {
    if (this.version === 1) return [];
    const numAlign = Math.floor(this.version / 7) + 2;
    const step =
      this.version === 32 ? 26 : Math.ceil((this.version * 4 + 4) / (numAlign * 2 - 2)) * 2;
    const result = [6];
    for (let pos = this.size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
    return result;
  }

  drawFormatBits(mask) {
    const data = (ECC[formatEccKey(this.eccOrdinal)].formatBits << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;

    for (let i = 0; i <= 5; i++) this.setFunctionModule(8, i, getBit(bits, i));
    this.setFunctionModule(8, 7, getBit(bits, 6));
    this.setFunctionModule(8, 8, getBit(bits, 7));
    this.setFunctionModule(7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i++) this.setFunctionModule(14 - i, 8, getBit(bits, i));

    for (let i = 0; i < 8; i++) this.setFunctionModule(this.size - 1 - i, 8, getBit(bits, i));
    for (let i = 8; i < 15; i++) this.setFunctionModule(8, this.size - 15 + i, getBit(bits, i));
    this.setFunctionModule(8, this.size - 8, true); // always dark
  }

  drawVersion() {
    if (this.version < 7) return;
    let rem = this.version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (this.version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = getBit(bits, i);
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFunctionModule(a, b, bit);
      this.setFunctionModule(b, a, bit);
    }
  }

  drawCodewords(data) {
    let i = 0; // bit index into data
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < this.size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vert : vert;
          if (!this.isFunction[y][x] && i < data.length * 8) {
            this.modules[y][x] = getBit(data[i >>> 3], 7 - (i & 7));
            i++;
          }
        }
      }
    }
  }

  applyMask(mask) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (this.isFunction[y][x]) continue;
        let invert;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          case 7: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: invert = false;
        }
        if (invert) this.modules[y][x] = !this.modules[y][x];
      }
    }
  }

  getPenaltyScore() {
    let result = 0;
    const size = this.size;
    // Adjacent modules in rows/columns.
    for (let y = 0; y < size; y++) {
      let runColor = false;
      let runX = 0;
      for (let x = 0; x < size; x++) {
        if (this.modules[y][x] === runColor) {
          runX++;
          if (runX === 5) result += 3;
          else if (runX > 5) result++;
        } else { runColor = this.modules[y][x]; runX = 1; }
      }
    }
    for (let x = 0; x < size; x++) {
      let runColor = false;
      let runY = 0;
      for (let y = 0; y < size; y++) {
        if (this.modules[y][x] === runColor) {
          runY++;
          if (runY === 5) result += 3;
          else if (runY > 5) result++;
        } else { runColor = this.modules[y][x]; runY = 1; }
      }
    }
    // 2x2 blocks.
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const c = this.modules[y][x];
        if (c === this.modules[y][x + 1] && c === this.modules[y + 1][x] && c === this.modules[y + 1][x + 1]) {
          result += 3;
        }
      }
    }
    // Finder-like patterns.
    for (let y = 0; y < size; y++) {
      let bits = 0;
      for (let x = 0; x < size; x++) {
        bits = ((bits << 1) & 0x7ff) | (this.modules[y][x] ? 1 : 0);
        if (x >= 10 && (bits === 0x05d || bits === 0x5d0)) result += 40;
      }
    }
    for (let x = 0; x < size; x++) {
      let bits = 0;
      for (let y = 0; y < size; y++) {
        bits = ((bits << 1) & 0x7ff) | (this.modules[y][x] ? 1 : 0);
        if (y >= 10 && (bits === 0x05d || bits === 0x5d0)) result += 40;
      }
    }
    // Balance of dark/light.
    let dark = 0;
    for (const row of this.modules) for (const cell of row) if (cell) dark++;
    const total = size * size;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    result += k * 10;
    return result;
  }
}

function formatEccKey(ordinal) {
  return Object.keys(ECC).find((k) => ECC[k].ordinal === ordinal) || 'M';
}

function getBit(x, i) {
  return ((x >>> i) & 1) !== 0;
}

// ── Top level ─────────────────────────────────────────────────────────────────
export function encodeQr(text, eccKey = 'M') {
  const key = ECC[eccKey] ? eccKey : 'M';
  const bytes = toUtf8Bytes(text);
  const { version, eccOrdinal, dataCodewords } = encodeSegments(bytes, key);
  const allCodewords = addEccAndInterleave(dataCodewords, version, eccOrdinal);

  const m = new QrMatrix(version, eccOrdinal);
  m.drawFunctionPatterns();
  m.drawCodewords(allCodewords);

  // Choose the mask with the lowest penalty.
  let bestMask = 0;
  let minPenalty = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    m.applyMask(mask);
    m.drawFormatBits(mask);
    const penalty = m.getPenaltyScore();
    if (penalty < minPenalty) { minPenalty = penalty; bestMask = mask; }
    m.applyMask(mask); // undo
  }
  m.applyMask(bestMask);
  m.drawFormatBits(bestMask);

  return {
    size: m.size,
    getModule: (x, y) => m.getModule(x, y),
  };
}

// Render to a crisp, scalable SVG string. Colours default to currentColor-free
// explicit values so it renders identically inside the app's cards.
export function qrToSvg(text, { ecc = 'M', border = 4, scale = 8, dark = '#0b0d12', light = '#ffffff' } = {}) {
  const qr = encodeQr(text, ecc);
  const dim = (qr.size + border * 2) * scale;
  let path = '';
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.getModule(x, y)) {
        const px = (x + border) * scale;
        const py = (y + border) * scale;
        path += `M${px},${py}h${scale}v${scale}h${-scale}z`;
      }
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${dim}" height="${dim}" ` +
    `shape-rendering="crispEdges" role="img" aria-label="QR code">` +
    `<rect width="${dim}" height="${dim}" fill="${light}"/>` +
    `<path d="${path}" fill="${dark}"/>` +
    `</svg>`
  );
}
