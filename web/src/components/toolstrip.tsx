import type { ReactNode } from 'react';

import type { DataSource } from '../api/xray/types';
import type { Route } from '../state';
import { Ballast, Guard, Sage, Scout } from './crew';

type Health = 'live' | 'sample' | 'off';

interface Tool {
  route: Route;
  mascot: ReactNode;
  name: string;
  product: string;
  health: Health;
  status: string;
  detail?: string;
}

const HEALTH_LABEL: Record<Health, string> = { live: 'Live', sample: 'Sample data', off: 'Not connected' };

interface ToolStripProps {
  xraySource: DataSource | null;
  xrayFallback: string | null;
  oatMode: 'http' | 'mock';
  pending: number | null;
  onNavigate: (route: Route) => void;
}

/** One line that says which tools are connected, replacing per-screen banners. */
export function ToolStrip({ xraySource, xrayFallback, oatMode, pending, onNavigate }: ToolStripProps) {
  const tools: Tool[] = [
    {
      route: 'understand',
      mascot: <Scout size={28} />,
      name: 'Scout',
      product: 'Repo X-Ray',
      health: xraySource === 'sample' ? 'sample' : xraySource ? 'live' : 'off',
      status: xraySource === 'sample' ? 'Sample analysis' : xraySource ? 'Mapping the repo' : 'Connecting…',
      detail:
        xraySource === 'sample'
          ? `X-Ray did not answer${xrayFallback ? ` (${xrayFallback})` : ''}. Start it with: xray serve --root <repo>`
          : undefined,
    },
    {
      route: 'trust',
      mascot: <Guard size={28} />,
      name: 'Guard',
      product: 'OpenAgentTrust',
      health: oatMode === 'http' ? 'live' : 'sample',
      status: pending ? `${pending} waiting for you` : pending === 0 ? 'Nothing waiting' : 'Checking…',
      detail: oatMode === 'mock' ? 'Built-in sample gateway. Set VITE_OAT_MODE=http and run oat serve.' : undefined,
    },
    {
      route: 'remember',
      mascot: <Sage size={28} />,
      name: 'Sage',
      product: 'Recall',
      health: 'sample',
      status: 'Sample decisions',
      detail: 'Recall is not connected yet; the decisions are samples.',
    },
    {
      route: 'optimize',
      mascot: <Ballast size={28} />,
      name: 'Ballast',
      product: 'BallastOS',
      health: 'off',
      status: 'Not connected yet',
    },
  ];
  return (
    <nav className="toolstrip" aria-label="Connected tools">
      {tools.map((tool) => (
        <a
          key={tool.name}
          href={`#/${tool.route}`}
          className="tool"
          title={tool.detail}
          onClick={(e) => {
            e.preventDefault();
            onNavigate(tool.route);
          }}
        >
          {tool.mascot}
          <span className="tool-text">
            <span className="tool-name">
              {tool.name} <span className="subtle">{tool.product}</span>
            </span>
            <span className="tool-status">
              <span className={`dot ${tool.health}`} aria-hidden="true" />
              <span className="visually-hidden">{HEALTH_LABEL[tool.health]}: </span>
              {tool.status}
            </span>
          </span>
        </a>
      ))}
    </nav>
  );
}
