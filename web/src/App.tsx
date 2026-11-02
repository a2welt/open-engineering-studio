import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { BrainIcon, BranchIcon, GaugeIcon, LayersIcon, MoonIcon, ShieldIcon, SparkIcon, SunIcon } from './components/icons';
import { Remember } from './screens/Remember';
import { Trust } from './screens/Trust';
import { Understand } from './screens/Understand';
import { useServices } from './services';
import { DEFAULT_QUESTION, type Route, repoName, useRoute, useXray } from './state';
import { useTheme } from './theme';

const NAV: { route: Route; label: string; icon: ReactNode }[] = [
  { route: 'understand', label: 'Understand', icon: <LayersIcon /> },
  { route: 'trust', label: 'Trust', icon: <ShieldIcon /> },
  { route: 'remember', label: 'Remember', icon: <BrainIcon /> },
  { route: 'optimize', label: 'Optimize', icon: <GaugeIcon /> },
];

const TITLES: Record<Route, string> = {
  understand: 'Understand',
  trust: 'Trust',
  remember: 'Remember',
  optimize: 'Optimize',
};

export function App() {
  const { oat } = useServices();
  const [theme, toggleTheme] = useTheme();
  const [route, navigate] = useRoute();
  const xray = useXray();
  const [pending, setPending] = useState<number | null>(null);
  const [question, setQuestion] = useState('');

  useEffect(() => {
    document.title = `${TITLES[route]} · Engineering Studio`;
  }, [route]);

  useEffect(() => {
    oat
      .pendingApprovals()
      .then((items) => setPending(items.length))
      .catch(() => setPending(null));
  }, [oat]);

  const { ask, impact, lookup } = xray;
  const affectedFilesFor = useCallback(
    async (path: string) => (await lookup(path))?.summary.total ?? null,
    [lookup],
  );

  const submitQuestion = (event: FormEvent) => {
    event.preventDefault();
    if (!question.trim()) return;
    navigate('understand');
    void ask(question);
  };

  const repo = repoName(xray.layers?.root);
  const commit = xray.layers?.repository?.commit.slice(0, 7);

  return (
    <div className="studio">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <ShieldIcon size={20} />
          </span>
          Engineering Studio
        </div>
        <form className="ask-bar" role="search" onSubmit={submitQuestion}>
          <SparkIcon size={20} />
          <label htmlFor="ask-bar" className="visually-hidden">
            Ask what breaks if a file changes
          </label>
          <input
            id="ask-bar"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={`What breaks if I change… e.g. ${DEFAULT_QUESTION.split('/').slice(-2).join('/')}`}
            autoComplete="off"
          />
        </form>
        <div className="topbar-end">
          {xray.layers && (
            <span className="repo-chip" title={xray.layers.repository?.url ?? xray.layers.root}>
              <BranchIcon size={16} />
              {repo}
              {commit ? ` · ${commit}` : ''}
              {xray.source === 'sample' ? ' (sample)' : ''}
            </span>
          )}
          <button
            type="button"
            className="icon-button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? <SunIcon size={20} /> : <MoonIcon size={20} />}
          </button>
        </div>
      </header>

      <div className="body">
        <nav className="rail" aria-label="Studio">
          {NAV.map((item) => (
            <a
              key={item.route}
              href={`#/${item.route}`}
              aria-current={route === item.route ? 'page' : undefined}
              onClick={(e) => {
                e.preventDefault();
                navigate(item.route);
              }}
            >
              <span className="pill">{item.icon}</span>
              {item.label}
              {item.route === 'trust' && pending ? (
                <span className="badge" aria-label={`${pending} waiting`}>
                  {pending}
                </span>
              ) : null}
            </a>
          ))}
        </nav>

        <main id="main" tabIndex={-1}>
          <h1 className="visually-hidden">{TITLES[route]}</h1>
          {route === 'understand' && <Understand xray={xray} pendingApprovals={pending} onNavigate={navigate} />}
          {route === 'trust' && (
            <Trust onPendingChange={setPending} affectedFilesFor={affectedFilesFor} onNavigate={navigate} />
          )}
          {(route === 'remember' || route === 'optimize') && (
            <Remember
              target={impact?.target.path ?? DEFAULT_QUESTION}
              neighbours={impact?.affected.map((a) => a.path) ?? []}
              focusSavings={route === 'optimize'}
            />
          )}
        </main>
      </div>
    </div>
  );
}
