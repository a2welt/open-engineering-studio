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
  hint?: string;
}

const HEALTH_LABEL: Record<Health, string> = { live: 'live', sample: 'sample data', off: 'not connected' };

interface ToolStripProps {
  xraySource: DataSource | null;
  xrayFallback: string | null;
  oatMode: 'http' | 'mock';
  pending: number | null;
  onNavigate: (route: Route) => void;
}

/** Four compact tool avatars for the top bar: mascot, status dot, details on hover. */
export function ToolStrip({ xraySource, xrayFallback, oatMode, pending, onNavigate }: ToolStripProps) {
  const tools: Tool[] = [
    {
      route: 'understand',
      mascot: <Scout size={30} />,
      name: 'Scout',
      product: 'Repo X-Ray',
      health: xraySource === 'sample' ? 'sample' : xraySource ? 'live' : 'off',
      status: xraySource === 'sample' ? 'Sample analysis' : xraySource ? 'Mapping the repo' : 'Connecting…',
      hint:
        xraySource === 'sample'
          ? `X-Ray did not answer${xrayFallback ? ` (${xrayFallback})` : ''}. Start it: xray serve --root <repo>`
          : undefined,
    },
    {
      route: 'trust',
      mascot: <Guard size={30} />,
      name: 'Guard',
      product: 'OpenAgentTrust',
      health: oatMode === 'http' ? 'live' : 'sample',
      status: pending ? `${pending} waiting for you` : pending === 0 ? 'Nothing waiting' : 'Checking…',
      hint: oatMode === 'mock' ? 'Built-in sample gateway. Set VITE_OAT_MODE=http and run oat serve.' : undefined,
    },
    {
      route: 'remember',
      mascot: <Sage size={30} />,
      name: 'Sage',
      product: 'Recall',
      health: 'sample',
      status: 'Sample decisions',
      hint: 'Recall is not connected yet.',
    },
    {
      route: 'optimize',
      mascot: <Ballast size={30} />,
      name: 'Ballast',
      product: 'BallastOS',
      health: 'off',
      status: 'Not connected yet',
    },
  ];
  return (
    <nav className="tools" aria-label="Connected tools">
      {tools.map((tool) => (
        <a
          key={tool.name}
          href={`#/${tool.route}`}
          className={`tool ${tool.health}`}
          aria-label={`${tool.name} (${tool.product}), ${HEALTH_LABEL[tool.health]}: ${tool.status}`}
          onClick={(e) => {
            e.preventDefault();
            onNavigate(tool.route);
          }}
        >
          {tool.mascot}
          <span className="dot" aria-hidden="true" />
          <span className="tool-card" role="tooltip">
            <strong>{tool.name}</strong> <span className="subtle">{tool.product}</span>
            <span className="tool-status">{tool.status}</span>
            {tool.hint && <span className="subtle">{tool.hint}</span>}
          </span>
        </a>
      ))}
    </nav>
  );
}
