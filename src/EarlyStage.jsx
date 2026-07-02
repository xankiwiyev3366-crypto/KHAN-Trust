// "Early Stage Projects" - lazy-loaded UI module. Kept as a standalone file
// (not part of the 400KB main.jsx bundle) so main.jsx can React.lazy() it and
// only ship this code to users who actually open the feature. Self-contained:
// it reuses existing global CSS classes (page-section, section-title,
// primary-button, form-field, project-grid, empty-state, analytics-*, etc.)
// plus a small set of dedicated `es-*` classes added to styles.css. It imports
// nothing from main.jsx, so there is zero risk of a circular import or of
// touching existing features - `navigate` is passed in as a prop.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Rocket,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  Globe2,
  Twitter,
  MessageCircle,
  Users,
  BadgeCheck,
  ShieldCheck,
  Lock,
  Star,
  StarOff,
  Eye,
  EyeOff,
  Archive,
  Check,
  X,
  Trash2,
  Plus,
  RefreshCw,
  Clock3,
  Milestone,
  ListChecks,
  Info,
  Search,
  ArrowUpDown,
} from 'lucide-react';
import { useTranslation } from './i18n/I18nContext.jsx';
import { adminLogin, getStoredAdminToken, clearAdminToken } from './verification.js';
import {
  EARLY_STAGE_STAGES,
  stageLabel,
  submitEarlyStageProject,
  fetchEarlyStageProjects,
  fetchEarlyStageProject,
  fetchEarlyStageAdmin,
  approveEarlyStage,
  rejectEarlyStage,
  archiveEarlyStage,
  featureEarlyStage,
  hideEarlyStage,
  deleteEarlyStage,
} from './earlyStage.js';

// The feature ships its own English strings and looks up i18n keys under
// `earlyStage.*`; if a translation is missing, `translate()` already falls
// back to English, and here we also fall back to the passed default so the UI
// never renders a raw key.
function useEs() {
  const { t } = useTranslation();
  const es = (key, fallback, params) => {
    const value = t(`earlyStage.${key}`, params);
    return value === `earlyStage.${key}` ? fallback : value;
  };
  return { t, es };
}

function EsSectionTitle({ icon: Icon, eyebrow, title }) {
  return (
    <div className="section-title">
      <span><Icon size={17} /> {eyebrow}</span>
      <h2>{title}</h2>
    </div>
  );
}

function EsEmptyState({ title, text }) {
  return (
    <div className="empty-state">
      <Rocket size={28} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

function StageBadge({ stage, es }) {
  return <span className={`es-stage-badge es-stage-${stage}`}>{es(`stages.${stage}`, stageLabel(stage))}</span>;
}

function ProgressBar({ value }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className="es-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

function LaunchpadTag({ url, label }) {
  if (url) {
    return (
      <a className="es-launchpad-tag" href={url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
        <Sparkles size={13} /> {label}
      </a>
    );
  }
  return <span className="es-launchpad-tag"><Sparkles size={13} /> {label}</span>;
}

function SocialLinks({ project, stop }) {
  const onClick = stop ? (e) => e.stopPropagation() : undefined;
  const links = [
    { url: project.website, Icon: Globe2, label: 'Website' },
    { url: project.twitter, Icon: Twitter, label: 'X' },
    { url: project.telegram, Icon: MessageCircle, label: 'Telegram' },
    { url: project.discord, Icon: Users, label: 'Discord' },
  ].filter((l) => l.url);
  if (!links.length) return null;
  return (
    <div className="es-social-row">
      {links.map(({ url, Icon, label }) => (
        <a key={label} href={url} target="_blank" rel="noreferrer" aria-label={label} onClick={onClick}>
          <Icon size={16} />
        </a>
      ))}
    </div>
  );
}

function EarlyStageCard({ project, navigate, es }) {
  const open = () => navigate(`early-stage/${project.id}`);
  return (
    <article className={`es-card${project.featured ? ' es-card-featured' : ''}`} onClick={open}>
      {project.featured && <span className="es-featured-flag"><Star size={12} /> {es('featured', 'Featured')}</span>}
      <div className="es-card-head">
        <div className="es-logo" aria-hidden="true">
          {project.logoUrl ? <img src={project.logoUrl} alt="" loading="lazy" /> : <Rocket size={22} />}
        </div>
        <div className="es-card-titles">
          <h3>
            {project.name}
            {project.symbol && <span className="es-symbol">{project.symbol}</span>}
            {project.teamVerified && <BadgeCheck size={16} className="es-verified" aria-label={es('teamVerified', 'Verified team')} />}
          </h3>
          <StageBadge stage={project.stage} es={es} />
        </div>
      </div>
      <p className="es-card-desc">{project.description}</p>
      <div className="es-meta-grid">
        {project.launchStatus && <span><Clock3 size={13} /> {project.launchStatus}</span>}
        {project.estimatedLaunch && <span><Rocket size={13} /> {project.estimatedLaunch}</span>}
        {project.chain && <span><Globe2 size={13} /> {project.chain}</span>}
        {project.category && <span><ListChecks size={13} /> {project.category}</span>}
        {project.communitySize > 0 && <span><Users size={13} /> {Number(project.communitySize).toLocaleString()}</span>}
      </div>
      <div className="es-progress-wrap">
        <span className="es-progress-label">{es('buildingProgress', 'Building progress')} <strong>{project.buildingProgress || 0}%</strong></span>
        <ProgressBar value={project.buildingProgress} />
      </div>
      <div className="es-card-foot">
        <SocialLinks project={project} stop />
        {project.builtWithLaunchpad && <LaunchpadTag url={project.launchpadUrl} label={es('builtWith', 'Built with KHAN Launchpad')} />}
      </div>
      <button className="card-button" type="button" onClick={(e) => { e.stopPropagation(); open(); }}>
        {es('viewProfile', 'View Profile')} <ArrowRight size={16} />
      </button>
    </article>
  );
}

// ---- List page -----------------------------------------------------------

// Investor-focused smart filters. Each is a pure predicate over a project, so
// filtering is instant and client-side (the full approved list is fetched once
// on mount). "Newly Added" = created within the last 30 days. "Verified Team"
// is future-ready: it already works the moment a project carries teamVerified.
const NEWLY_ADDED_DAYS = 30;
const SMART_FILTERS = [
  { id: 'all', match: () => true },
  { id: 'newlyAdded', match: (p) => daysSince(p.createdAt) <= NEWLY_ADDED_DAYS },
  { id: 'featured', match: (p) => Boolean(p.featured) },
  { id: 'launchingSoon', match: (p) => p.stage === 'launching_soon' },
  { id: 'testnet', match: (p) => p.stage === 'testnet' },
  { id: 'mainnet', match: (p) => p.stage === 'mainnet_live' },
  { id: 'verifiedTeam', match: (p) => Boolean(p.teamVerified) },
];

// Sort comparators keyed by option id. Newest is the default.
const SORT_OPTIONS = ['newest', 'oldest', 'updated', 'community', 'progress'];
const SORTERS = {
  newest: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
  oldest: (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
  updated: (a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt),
  community: (a, b) => (Number(b.communitySize) || 0) - (Number(a.communitySize) || 0),
  progress: (a, b) => (Number(b.buildingProgress) || 0) - (Number(a.buildingProgress) || 0),
};

function daysSince(dateStr) {
  const then = new Date(dateStr).getTime();
  if (!then) return Infinity;
  return Math.floor((Date.now() - then) / 86400000);
}

// Small debounce hook - keeps the grid filter + autocomplete from recomputing
// on every keystroke (spec: ~250ms). Returns the debounced value plus a
// `flush` that commits the latest value immediately (used by the Search
// button so a click applies the query without waiting out the debounce).
function useDebouncedValue(value, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  const timerRef = useRef(null);
  useEffect(() => {
    timerRef.current = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timerRef.current);
  }, [value, delay]);
  const flush = useCallback(() => {
    clearTimeout(timerRef.current);
    setDebounced(value);
  }, [value]);
  return [debounced, flush];
}

// Match a project against a free-text query on name, symbol, and category.
function matchesQuery(project, needle) {
  if (!needle) return true;
  const haystack = `${project.name || ''} ${project.symbol || ''} ${project.category || ''}`.toLowerCase();
  return haystack.includes(needle);
}

export function EarlyStageListPage({ navigate }) {
  const { es } = useEs();
  const [allProjects, setAllProjects] = useState([]);
  const [activeFilter, setActiveFilter] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  const [query, setQuery] = useState('');
  const [state, setState] = useState({ status: 'loading', message: '' });

  // Autocomplete state
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const searchWrapRef = useRef(null);

  const [debouncedQuery, flushQuery] = useDebouncedValue(query, 250);
  const needle = debouncedQuery.trim().toLowerCase();

  // Fetch the full approved list once; every filter/sort/search below runs
  // client-side so it stays instant and issues no extra requests.
  const load = useCallback(async () => {
    setState({ status: 'loading', message: '' });
    try {
      const data = await fetchEarlyStageProjects({});
      setAllProjects(data.projects || []);
      setState({ status: 'idle', message: '' });
    } catch (error) {
      setState({ status: 'error', message: error.message || 'Could not load projects.' });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Close the suggestions dropdown on any outside click.
  useEffect(() => {
    if (!showSuggestions) return undefined;
    const onDocClick = (e) => {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target)) setShowSuggestions(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [showSuggestions]);

  // Only offer smart filters that actually have at least one project, so users
  // never tap into a dead end (All is always shown).
  const availableFilters = useMemo(
    () => SMART_FILTERS.filter((f) => f.id === 'all' || allProjects.some((p) => f.match(p))),
    [allProjects]
  );

  // If the active filter becomes empty (e.g. data reloaded), fall back to All.
  useEffect(() => {
    if (!availableFilters.some((f) => f.id === activeFilter)) setActiveFilter('all');
  }, [availableFilters, activeFilter]);

  const filterMatch = useMemo(
    () => (SMART_FILTERS.find((f) => f.id === activeFilter) || SMART_FILTERS[0]).match,
    [activeFilter]
  );

  const visibleProjects = useMemo(() => {
    const list = allProjects.filter((p) => filterMatch(p) && matchesQuery(p, needle));
    return list.sort(SORTERS[sortBy] || SORTERS.newest);
  }, [allProjects, filterMatch, needle, sortBy]);

  // Autocomplete suggestions: up to 5, from the whole list (ignores the active
  // filter so search always finds any project), matched on name/symbol/category.
  const suggestions = useMemo(() => {
    if (!needle) return [];
    return allProjects.filter((p) => matchesQuery(p, needle)).slice(0, 5);
  }, [allProjects, needle]);

  useEffect(() => { setActiveIndex(-1); }, [needle]);

  const openProject = (project) => {
    if (!project) return;
    setShowSuggestions(false);
    navigate(`early-stage/${project.id}`);
  };

  const onSearchKeyDown = (e) => {
    if (!showSuggestions || !suggestions.length) {
      if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur(); }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      openProject(suggestions[activeIndex >= 0 ? activeIndex : 0]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setShowSuggestions(false);
    }
  };

  const clearSearch = () => { setQuery(''); setShowSuggestions(false); };

  // Explicit Search button: apply the current query immediately (bypassing the
  // debounce) and close the suggestions dropdown. The grid already filters on
  // the same query, so this simply commits it without waiting.
  const runSearch = () => { flushQuery(); setShowSuggestions(false); };

  const hasAny = allProjects.length > 0;
  const isFiltered = Boolean(needle) || activeFilter !== 'all';

  return (
    <section className="page-section es-page">
      <EsSectionTitle icon={Rocket} eyebrow={es('eyebrow', 'Pre-launch')} title={es('title', 'Early Stage Projects')} />
      <p className="section-subtitle es-intro">{es('intro', 'Discover crypto projects building in the open - from idea to testnet to launch. Join KHAN Trust before you go public and build trust from day one.')}</p>

      <div className="es-toolbar">
        <div className="es-search-group">
        <div className="es-autocomplete" ref={searchWrapRef}>
          <Search size={16} className="es-search-icon" aria-hidden="true" />
          <input
            type="text"
            role="combobox"
            aria-expanded={showSuggestions && suggestions.length > 0}
            aria-controls="es-suggestion-list"
            aria-autocomplete="list"
            autoComplete="off"
            value={query}
            placeholder={es('searchPlaceholder', 'Search early-stage projects...')}
            onChange={(e) => { setQuery(e.target.value); setShowSuggestions(true); }}
            onFocus={() => setShowSuggestions(true)}
            onKeyDown={onSearchKeyDown}
          />
          {query && (
            <button className="es-search-clear" type="button" aria-label={es('clearSearch', 'Clear search')} onClick={clearSearch}>
              <X size={15} />
            </button>
          )}
          {showSuggestions && suggestions.length > 0 && (
            <ul className="es-suggestions" id="es-suggestion-list" role="listbox">
              {suggestions.map((p, i) => (
                <li
                  key={p.id}
                  role="option"
                  aria-selected={i === activeIndex}
                  className={i === activeIndex ? 'active' : ''}
                  onMouseEnter={() => setActiveIndex(i)}
                  onMouseDown={(e) => { e.preventDefault(); openProject(p); }}
                >
                  <span className="es-suggest-logo" aria-hidden="true">
                    {p.logoUrl ? <img src={p.logoUrl} alt="" loading="lazy" /> : <Rocket size={14} />}
                  </span>
                  <span className="es-suggest-main">
                    <strong>{p.name}{p.symbol ? <em> · {p.symbol}</em> : null}</strong>
                    {p.category && <small>{p.category}</small>}
                  </span>
                  <StageBadge stage={p.stage} es={es} />
                </li>
              ))}
            </ul>
          )}
        </div>
        <button className="secondary-button es-search-btn" type="button" onClick={runSearch}>
          <Search size={16} /> {es('search', 'Search')}
        </button>
        </div>
        <button className="primary-button" type="button" onClick={() => navigate('early-stage-submit')}>
          <Plus size={16} /> {es('submitCta', 'Submit Your Project')}
        </button>
      </div>

      <div className="es-controls">
        <div className="filter-row es-filter-row">
          {availableFilters.map((f) => (
            <button key={f.id} className={activeFilter === f.id ? 'active' : ''} onClick={() => setActiveFilter(f.id)}>
              {es(`smartFilters.${f.id}`, f.id)}
            </button>
          ))}
        </div>
        <label className="es-sort">
          <ArrowUpDown size={15} aria-hidden="true" />
          <span className="es-sort-label">{es('sort.label', 'Sort')}</span>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            {SORT_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{es(`sort.${opt}`, opt)}</option>
            ))}
          </select>
        </label>
      </div>

      {state.status === 'loading' && <p className="lookup-message">{es('loading', 'Loading projects...')}</p>}
      {state.status === 'error' && <p className="lookup-message error">{state.message}</p>}

      {state.status === 'idle' && (
        visibleProjects.length ? (
          <div className="project-grid es-grid">
            {visibleProjects.map((project) => (
              <EarlyStageCard key={project.id} project={project} navigate={navigate} es={es} />
            ))}
          </div>
        ) : !hasAny ? (
          <EsEmptyState
            title={es('emptyTitle', 'No early-stage projects yet')}
            text={es('emptyText', 'Be the first to list your pre-launch project and start building trust with the KHAN community.')}
          />
        ) : (
          <div className="empty-state">
            <Search size={28} />
            <h3>{es('noMatchTitle', 'No matching early-stage projects found.')}</h3>
            {isFiltered && (
              <button className="secondary-button" type="button" onClick={() => { clearSearch(); setActiveFilter('all'); }}>
                {es('clearSearch', 'Clear Search')}
              </button>
            )}
          </div>
        )
      )}
    </section>
  );
}

// ---- Profile page --------------------------------------------------------

function ProfileList({ title, icon: Icon, entries, timeline, es }) {
  if (!entries || !entries.length) return null;
  return (
    <div className="es-profile-block">
      <h3><Icon size={18} /> {title}</h3>
      <ul className={timeline ? 'es-timeline' : 'es-entry-list'}>
        {entries.map((entry, i) => (
          <li key={i} className={entry.done ? 'es-entry-done' : ''}>
            <strong>{entry.done ? <Check size={14} /> : null}{entry.title}</strong>
            {entry.detail && <span>{entry.detail}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function EarlyStageProfilePage({ projectId, navigate }) {
  const { es } = useEs();
  const [project, setProject] = useState(null);
  const [state, setState] = useState({ status: 'loading', message: '' });

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading', message: '' });
    fetchEarlyStageProject(projectId)
      .then((data) => {
        if (!alive) return;
        if (!data) { setState({ status: 'notfound', message: '' }); return; }
        setProject(data);
        setState({ status: 'idle', message: '' });
      })
      .catch((error) => { if (alive) setState({ status: 'error', message: error.message }); });
    return () => { alive = false; };
  }, [projectId]);

  if (state.status === 'loading') {
    return <section className="page-section"><p className="lookup-message">{es('loading', 'Loading project...')}</p></section>;
  }
  if (state.status === 'notfound' || state.status === 'error') {
    return (
      <section className="page-section">
        <button className="back-button" onClick={() => navigate('early-stage')}><ArrowLeft size={16} /> {es('back', 'Back to Early Stage')}</button>
        <EsEmptyState title={es('notFoundTitle', 'Project not found')} text={es('notFoundText', 'This early-stage project may have been removed or is not yet approved.')} />
      </section>
    );
  }

  return (
    <section className="page-section es-profile">
      <button className="back-button" onClick={() => navigate('early-stage')}><ArrowLeft size={16} /> {es('back', 'Back to Early Stage')}</button>

      <header className="es-profile-head">
        <div className="es-logo es-logo-lg" aria-hidden="true">
          {project.logoUrl ? <img src={project.logoUrl} alt="" /> : <Rocket size={30} />}
        </div>
        <div className="es-profile-head-main">
          <h1>
            {project.name}
            {project.teamVerified && <BadgeCheck size={22} className="es-verified" aria-label={es('teamVerified', 'Verified team')} />}
          </h1>
          <div className="es-profile-badges">
            <StageBadge stage={project.stage} es={es} />
            {project.launchStatus && <span className="status-badge">{project.launchStatus}</span>}
            {project.chain && <span className="status-badge">{project.chain}</span>}
            {project.category && <span className="status-badge">{project.category}</span>}
          </div>
          <p className="es-profile-desc">{project.description}</p>
          <SocialLinks project={project} />
          {project.builtWithLaunchpad && (
            <div className="es-profile-launchpad">
              <LaunchpadTag url={project.launchpadUrl} label={es('builtWith', 'Built with KHAN Launchpad')} />
              <button className="ghost-button" type="button" onClick={() => navigate('launchpad')}>
                {es('openLaunchpad', 'Open KHAN Launchpad')} <ArrowRight size={14} />
              </button>
            </div>
          )}
        </div>
        <div className="es-profile-side">
          <div className="es-side-stat">
            <span>{es('launch', 'Estimated launch')}</span>
            <strong>{project.estimatedLaunch || es('tbd', 'TBD')}</strong>
          </div>
          <div className="es-side-stat">
            <span>{es('community', 'Community size')}</span>
            <strong>{Number(project.communitySize || 0).toLocaleString()}</strong>
          </div>
          <div className="es-side-stat">
            <span>{es('buildingProgress', 'Building progress')}</span>
            <strong>{project.buildingProgress || 0}%</strong>
            <ProgressBar value={project.buildingProgress} />
          </div>
        </div>
      </header>

      <div className="es-profile-body">
        {project.overview && (
          <div className="es-profile-block">
            <h3><Info size={18} /> {es('overview', 'Overview')}</h3>
            <p>{project.overview}</p>
          </div>
        )}
        {project.whyEarlyStage && (
          <div className="es-profile-block">
            <h3><Sparkles size={18} /> {es('whyEarlyStage', 'Why Early Stage')}</h3>
            <p>{project.whyEarlyStage}</p>
          </div>
        )}
        <ProfileList title={es('roadmap', 'Roadmap')} icon={Milestone} entries={project.roadmap} es={es} />
        <ProfileList title={es('progressTimeline', 'Progress Timeline')} icon={Clock3} entries={project.progressTimeline} timeline es={es} />
        <ProfileList title={es('milestones', 'Upcoming Milestones')} icon={ListChecks} entries={project.milestones} es={es} />
        <ProfileList title={es('team', 'Team')} icon={Users} entries={project.team} es={es} />

        <div className="es-profile-block es-ai-preview">
          <h3><ShieldCheck size={18} /> {es('aiPreview', 'AI Trust Preview')}</h3>
          <p>{es('aiPreviewText', 'This project is pre-launch, so a full KHAN AI Trust Score is not yet available. A complete AI Trust Score and Risk Analysis will be generated automatically once the project has a live token and on-chain activity to analyze.')}</p>
        </div>
        {project.riskNotes && (
          <div className="es-profile-block">
            <h3><Info size={18} /> {es('riskNotes', 'Risk Notes')}</h3>
            <p>{project.riskNotes}</p>
          </div>
        )}
      </div>
    </section>
  );
}

// ---- Submit page ---------------------------------------------------------

const EMPTY_SUBMIT = {
  name: '', symbol: '', description: '', stage: 'idea', launchStatus: '', estimatedLaunch: '',
  chain: '', category: '', logoUrl: '', website: '', twitter: '', telegram: '', discord: '',
  communitySize: '', buildingProgress: '', teamVerified: false, builtWithLaunchpad: false, launchpadUrl: '',
  overview: '', whyEarlyStage: '', riskNotes: '', contactName: '', contactEmail: '', company: '',
};

function Field({ label, value, onChange, type = 'text', textarea, placeholder, required }) {
  return (
    <label className="form-field">
      <span>{label}{required && ' *'}</span>
      {textarea
        ? <textarea value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} rows={4} />
        : <input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />}
    </label>
  );
}

export function EarlyStageSubmitPage({ navigate }) {
  const { es } = useEs();
  const [form, setForm] = useState(EMPTY_SUBMIT);
  const [state, setState] = useState({ status: 'idle', message: '' });
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.description.trim()) {
      setState({ status: 'error', message: es('submitMissing', 'Project name and short description are required.') });
      return;
    }
    setState({ status: 'loading', message: '' });
    try {
      const res = await submitEarlyStageProject(form);
      setState({ status: 'success', message: es('submitSuccess', 'Submitted! Your project will appear once approved by the KHAN Trust team.'), id: res.projectId });
      setForm(EMPTY_SUBMIT);
    } catch (error) {
      setState({ status: 'error', message: error.message || es('submitError', 'Submission failed. Please try again.') });
    }
  };

  if (state.status === 'success') {
    return (
      <section className="page-section">
        <EsSectionTitle icon={Rocket} eyebrow={es('eyebrow', 'Pre-launch')} title={es('submitTitle', 'Submit Your Early-Stage Project')} />
        <div className="empty-state">
          <BadgeCheck size={30} />
          <h3>{es('submitThanks', 'Thank you!')}</h3>
          <p>{state.message}</p>
          <button className="primary-button" type="button" onClick={() => navigate('early-stage')}>
            {es('backToList', 'Back to Early Stage Projects')} <ArrowRight size={16} />
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="page-section es-submit">
      <button className="back-button" onClick={() => navigate('early-stage')}><ArrowLeft size={16} /> {es('back', 'Back to Early Stage')}</button>
      <EsSectionTitle icon={Rocket} eyebrow={es('eyebrow', 'Pre-launch')} title={es('submitTitle', 'Submit Your Early-Stage Project')} />
      <p className="section-subtitle">{es('submitIntro', 'List your pre-launch project on KHAN Trust. Submissions are reviewed before going live.')}</p>

      <form className="add-form es-form" onSubmit={submit}>
        {/* Honeypot - hidden from real users */}
        <input type="text" name="company" value={form.company} onChange={(e) => set('company')(e.target.value)} tabIndex={-1} autoComplete="off" style={{ display: 'none' }} aria-hidden="true" />

        <div className="es-form-grid">
          <Field label={es('f.name', 'Project name')} value={form.name} onChange={set('name')} required />
          <Field label={es('f.symbol', 'Symbol / Ticker')} value={form.symbol} onChange={set('symbol')} placeholder={es('f.symbolPh', 'e.g. KHAN')} />
          <Field label={es('f.logo', 'Logo URL')} value={form.logoUrl} onChange={set('logoUrl')} placeholder="https://" />
          <label className="form-field">
            <span>{es('f.stage', 'Current stage')}</span>
            <select value={form.stage} onChange={(e) => set('stage')(e.target.value)}>
              {EARLY_STAGE_STAGES.map((s) => <option key={s.id} value={s.id}>{es(`stages.${s.id}`, s.label)}</option>)}
            </select>
          </label>
          <Field label={es('f.launchStatus', 'Launch status')} value={form.launchStatus} onChange={set('launchStatus')} placeholder={es('f.launchStatusPh', 'e.g. Coming Soon')} />
          <Field label={es('f.estimatedLaunch', 'Estimated launch date')} value={form.estimatedLaunch} onChange={set('estimatedLaunch')} placeholder={es('f.estimatedLaunchPh', 'e.g. Q3 2026')} />
          <Field label={es('f.chain', 'Blockchain')} value={form.chain} onChange={set('chain')} placeholder="e.g. Solana" />
          <Field label={es('f.category', 'Category')} value={form.category} onChange={set('category')} placeholder="e.g. DeFi" />
          <Field label={es('f.community', 'Community size')} value={form.communitySize} onChange={set('communitySize')} type="number" />
          <Field label={es('f.progress', 'Building progress (%)')} value={form.buildingProgress} onChange={set('buildingProgress')} type="number" />
        </div>

        <Field label={es('f.description', 'Short description')} value={form.description} onChange={set('description')} textarea required />
        <Field label={es('f.overview', 'Overview')} value={form.overview} onChange={set('overview')} textarea />
        <Field label={es('f.why', 'Why early stage')} value={form.whyEarlyStage} onChange={set('whyEarlyStage')} textarea />
        <Field label={es('f.riskNotes', 'Risk notes')} value={form.riskNotes} onChange={set('riskNotes')} textarea />

        <div className="es-form-grid">
          <Field label={es('f.website', 'Website')} value={form.website} onChange={set('website')} placeholder="https://" />
          <Field label={es('f.twitter', 'X (Twitter)')} value={form.twitter} onChange={set('twitter')} placeholder="https://" />
          <Field label={es('f.telegram', 'Telegram')} value={form.telegram} onChange={set('telegram')} placeholder="https://" />
          <Field label={es('f.discord', 'Discord')} value={form.discord} onChange={set('discord')} placeholder="https://" />
          <Field label={es('f.contactName', 'Contact name')} value={form.contactName} onChange={set('contactName')} />
          <Field label={es('f.contactEmail', 'Contact email')} value={form.contactEmail} onChange={set('contactEmail')} type="email" />
        </div>

        <label className="es-check">
          <input type="checkbox" checked={form.builtWithLaunchpad} onChange={(e) => set('builtWithLaunchpad')(e.target.checked)} />
          <span>{es('f.builtWith', 'This project was created with KHAN Launchpad')}</span>
        </label>
        {form.builtWithLaunchpad && (
          <Field label={es('f.launchpadUrl', 'Launchpad link')} value={form.launchpadUrl} onChange={set('launchpadUrl')} placeholder="https://" />
        )}

        {state.message && <p className={`lookup-message ${state.status === 'error' ? 'error' : ''}`}>{state.message}</p>}
        <button className="primary-button wide-button" type="submit" disabled={state.status === 'loading'}>
          {state.status === 'loading' ? es('submitting', 'Submitting...') : es('submitBtn', 'Submit Project')} <ArrowRight size={18} />
        </button>
      </form>
    </section>
  );
}

// ---- Admin page ----------------------------------------------------------

const ADMIN_TABS = ['pending', 'approved', 'rejected', 'archived', 'all'];

export function EarlyStageAdminPage() {
  const { es } = useEs();
  const [token, setToken] = useState(() => getStoredAdminToken());
  const [passcode, setPasscode] = useState('');
  const [authState, setAuthState] = useState({ status: 'idle', message: '' });
  const [projects, setProjects] = useState([]);
  const [stats, setStats] = useState(null);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [search, setSearch] = useState('');
  const [listState, setListState] = useState({ status: 'idle', message: '' });
  const [busyId, setBusyId] = useState(null);

  const load = async (activeToken = token) => {
    if (!activeToken) return;
    setListState({ status: 'loading', message: '' });
    try {
      const data = await fetchEarlyStageAdmin(activeToken, { status: statusFilter, search });
      setProjects(data.projects || []);
      setStats(data.stats || null);
      setListState({ status: 'idle', message: '' });
    } catch (error) {
      setListState({ status: 'error', message: error.message || 'Load failed.' });
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token, statusFilter]);

  const login = async (e) => {
    e.preventDefault();
    setAuthState({ status: 'loading', message: '' });
    try {
      const newToken = await adminLogin(passcode);
      setToken(newToken);
      setAuthState({ status: 'idle', message: '' });
    } catch (error) {
      setAuthState({ status: 'error', message: error.message || 'Login failed.' });
    }
  };

  const act = async (fn, id, ...args) => {
    setBusyId(id);
    try {
      await fn(token, id, ...args);
      await load();
    } catch (error) {
      setListState({ status: 'error', message: error.message || 'Action failed.' });
    } finally {
      setBusyId(null);
    }
  };

  if (!token) {
    return (
      <section className="page-section">
        <EsSectionTitle icon={Lock} eyebrow="Admin" title={es('adminTitle', 'Early Stage Admin')} />
        <form className="add-form admin-login-form" onSubmit={login}>
          <label className="form-field">
            <span>{es('adminPasscode', 'Admin passcode')}</span>
            <input type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} required />
          </label>
          <button className="primary-button wide-button" type="submit" disabled={authState.status === 'loading'}>
            {es('signIn', 'Sign In')} <ArrowRight size={18} />
          </button>
          {authState.message && <p className="lookup-message error">{authState.message}</p>}
        </form>
      </section>
    );
  }

  return (
    <section className="page-section analytics-dashboard es-admin">
      <EsSectionTitle icon={Rocket} eyebrow="Admin" title={es('adminTitle', 'Early Stage Admin')} />
      <div className="analytics-toolbar">
        <button className="secondary-button" type="button" onClick={() => load()}><RefreshCw size={15} /> {es('refresh', 'Refresh')}</button>
        <button className="ghost-button" type="button" onClick={() => { clearAdminToken(); setToken(''); setProjects([]); setStats(null); }}>{es('signOut', 'Sign Out')}</button>
      </div>

      {stats && (
        <div className="analytics-stat-grid">
          <div className="stat-card"><span>{es('adminStats.pending', 'Pending')}</span><strong>{stats.pending}</strong></div>
          <div className="stat-card"><span>{es('adminStats.approved', 'Approved')}</span><strong>{stats.approved}</strong></div>
          <div className="stat-card"><span>{es('adminStats.rejected', 'Rejected')}</span><strong>{stats.rejected}</strong></div>
          <div className="stat-card"><span>{es('adminStats.archived', 'Archived')}</span><strong>{stats.archived}</strong></div>
          <div className="stat-card"><span>{es('adminStats.featured', 'Featured')}</span><strong>{stats.featured}</strong></div>
        </div>
      )}

      <div className="es-admin-filters">
        <div className="filter-row">
          {ADMIN_TABS.map((tab) => (
            <button key={tab} className={statusFilter === tab ? 'active' : ''} onClick={() => setStatusFilter(tab)}>
              {es(`adminStats.${tab}`, tab.charAt(0).toUpperCase() + tab.slice(1))}
            </button>
          ))}
        </div>
        <div className="es-search">
          <input type="search" value={search} placeholder={es('adminSearch', 'Search submissions...')} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') load(); }} />
          <button className="secondary-button" type="button" onClick={() => load()}>{es('search', 'Search')}</button>
        </div>
      </div>

      {listState.status === 'loading' && <p className="lookup-message">{es('loading', 'Loading...')}</p>}
      {listState.status === 'error' && <p className="lookup-message error">{listState.message}</p>}

      <div className="es-admin-list">
        {projects.map((p) => (
          <article key={p.id} className="es-admin-row">
            <div className="es-admin-row-main">
              <div className="es-logo" aria-hidden="true">{p.logoUrl ? <img src={p.logoUrl} alt="" /> : <Rocket size={18} />}</div>
              <div>
                <h4>{p.name} {p.featured && <Star size={13} className="es-verified" />}{p.hidden && <EyeOff size={13} />}</h4>
                <p className="es-admin-meta">
                  <StageBadge stage={p.stage} es={es} />
                  <span className={`es-status es-status-${p.status}`}>{es(`adminStats.${p.status}`, p.status)}</span>
                  {p.chain && <span>{p.chain}</span>}
                  {p.category && <span>{p.category}</span>}
                  {p.contactEmail && <span>{p.contactEmail}</span>}
                </p>
                <p className="es-admin-desc">{p.description}</p>
              </div>
            </div>
            <div className="es-admin-actions">
              {p.status !== 'approved' && <button className="secondary-button" disabled={busyId === p.id} onClick={() => act(approveEarlyStage, p.id)}><Check size={14} /> {es('approve', 'Approve')}</button>}
              {p.status !== 'rejected' && <button className="ghost-button" disabled={busyId === p.id} onClick={() => act(rejectEarlyStage, p.id)}><X size={14} /> {es('reject', 'Reject')}</button>}
              <button className="ghost-button" disabled={busyId === p.id} onClick={() => act(featureEarlyStage, p.id, !p.featured)}>{p.featured ? <StarOff size={14} /> : <Star size={14} />} {p.featured ? es('unfeature', 'Unfeature') : es('feature', 'Feature')}</button>
              <button className="ghost-button" disabled={busyId === p.id} onClick={() => act(hideEarlyStage, p.id, !p.hidden)}>{p.hidden ? <Eye size={14} /> : <EyeOff size={14} />} {p.hidden ? es('unhide', 'Unhide') : es('hide', 'Hide')}</button>
              {p.status !== 'archived' && <button className="ghost-button" disabled={busyId === p.id} onClick={() => act(archiveEarlyStage, p.id)}><Archive size={14} /> {es('archive', 'Archive')}</button>}
              <button className="ghost-button es-danger" disabled={busyId === p.id} onClick={() => { if (window.confirm(es('deleteConfirm', 'Permanently delete this submission?'))) act(deleteEarlyStage, p.id); }}><Trash2 size={14} /> {es('delete', 'Delete')}</button>
            </div>
          </article>
        ))}
        {listState.status === 'idle' && !projects.length && (
          <EsEmptyState title={es('adminEmptyTitle', 'Nothing here')} text={es('adminEmptyText', 'No submissions match this filter.')} />
        )}
      </div>
    </section>
  );
}

// ---- Router --------------------------------------------------------------
// main.jsx lazy-loads this default export and passes {view, projectId,
// navigate}. Keeping the branch here (rather than four lazy imports) means one
// dynamic import serves the whole feature.
export default function EarlyStage({ view, projectId, navigate }) {
  if (view === 'submit') return <EarlyStageSubmitPage navigate={navigate} />;
  if (view === 'admin') return <EarlyStageAdminPage />;
  if (view === 'profile') return <EarlyStageProfilePage projectId={projectId} navigate={navigate} />;
  return <EarlyStageListPage navigate={navigate} />;
}
