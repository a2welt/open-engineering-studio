import { useCallback, useEffect, useState, type ReactNode } from 'react';

import {
  BrainIcon,
  CycleIcon,
  GaugeIcon,
  LayersIcon,
  MoonIcon,
  ShieldIcon,
  SunIcon,
} from './components/icons';
import { ToolStrip } from './components/toolstrip';
import { Lifecycle } from './screens/Lifecycle';
import { Remember } from './screens/Remember';
import { Trust } from './screens/Trust';
import { Understand } from './screens/Understand';
import { useServices } from './services';
import { DEFAULT_QUESTION, type Route, useRoute, useXray } from './state';
import { useTheme } from './theme';

const NAV: { route: Route; label: string; icon: ReactNode }[] = [
  { route: 'lifecycle', label: 'Lifecycle', icon: <CycleIcon /> },
  { route: 'understand', label: 'Understand', icon: <LayersIcon /> },
  { route: 'trust', label: 'Trust', icon: <ShieldIcon /> },
  { route: 'remember', label: 'Remember', icon: <BrainIcon /> },
  { route: 'optimize', label: 'Optimize', icon: <GaugeIcon /> },
];

/** The glass shield from the design: a gradient fill under a light rim. */
function BrandMark() {
  return (
    <svg width="34" height="34" viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <linearGradient id="brand-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#C4B5FD" />
          <stop offset="0.5" stopColor="#F0ABFC" />
          <stop offset="1" stopColor="#FDBA74" />
        </linearGradient>
        <linearGradient id="brand-rim" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.9" />
          <stop offset="0.5" stopColor="#FFFFFF" stopOpacity="0.1" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0.6" />
        </linearGradient>
      </defs>
      <path d="M24 4l16 6.5v11c0 10-7 17-16 21-9-4-16-11-16-21v-11z" fill="url(#brand-fill)" opacity="0.85" />
      <path d="M24 4l16 6.5v11c0 10-7 17-16 21-9-4-16-11-16-21v-11z" fill="none" stroke="url(#brand-rim)" strokeWidth="1.5" />
      <path d="M16.5 24l5 5 10-10" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const TITLES: Record<Route, string> = {
  lifecycle: 'Lifecycle',
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

  useEffect(() => {
    document.title = `${TITLES[route]} · Engineering Studio`;
  }, [route]);

  useEffect(() => {
    oat
      .pendingApprovals()
      .then((items) => setPending(items.length))
      .catch(() => setPending(null));
  }, [oat]);

  const { impact, lookup } = xray;
  const affectedFilesFor = useCallback(
    async (path: string) => (await lookup(path))?.summary.total ?? null,
    [lookup],
  );

  return (
    <div className="studio">
      <div className="backdrop" aria-hidden="true">
        <div className="blob b1" />
        <div className="blob b2" />
        <div className="blob b3" />
        <div className="blob b4" />
        <div className="blob b5" />
      </div>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <BrandMark />
          </span>
          Engineering Studio
        </div>
        <nav className="tabs" aria-label="Studio">
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
              <span className="tab-icon">{item.icon}</span>
              <span className="tab-label">{item.label}</span>
              {item.route === 'trust' && pending ? (
                <span className="badge" aria-label={`${pending} waiting`}>
                  {pending}
                </span>
              ) : null}
            </a>
          ))}
        </nav>
        <div className="topbar-end">
          <ToolStrip
            xraySource={xray.source}
            xrayFallback={xray.fallbackReason}
            oatMode={oat.mode}
            pending={pending}
            onNavigate={navigate}
          />
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
        <main id="main" tabIndex={-1}>
          <h1 className="visually-hidden">{TITLES[route]}</h1>
          {route === 'lifecycle' && <Lifecycle xray={xray} onNavigate={navigate} />}
          {route === 'understand' && <Understand xray={xray} onNavigate={navigate} />}
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
