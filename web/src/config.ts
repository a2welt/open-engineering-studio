import { DEFAULT_OAT_PATHS, type OatPaths } from './api/oat/types';

export type XrayMode = 'auto' | 'http' | 'mock';
export type OatMode = 'http' | 'mock';

export interface StudioConfig {
  xray: { mode: XrayMode; baseUrl: string };
  oat: { mode: OatMode; baseUrl: string; paths: OatPaths };
}

function parsePaths(raw: string | undefined): OatPaths {
  if (!raw) return DEFAULT_OAT_PATHS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const overrides = Object.fromEntries(
        Object.entries(parsed).filter(
          ([key, value]) => key in DEFAULT_OAT_PATHS && typeof value === 'string',
        ),
      );
      return { ...DEFAULT_OAT_PATHS, ...overrides };
    }
  } catch {
    console.warn('VITE_OAT_PATHS is not valid JSON; using the default endpoint paths.');
  }
  return DEFAULT_OAT_PATHS;
}

export function readConfig(env: Record<string, string | undefined> = import.meta.env): StudioConfig {
  const xrayMode = env.VITE_XRAY_MODE;
  const oatMode = env.VITE_OAT_MODE;
  return {
    xray: {
      mode: xrayMode === 'http' || xrayMode === 'mock' ? xrayMode : 'auto',
      baseUrl: env.VITE_XRAY_BASE_URL || '/xray',
    },
    oat: {
      mode: oatMode === 'http' ? 'http' : 'mock',
      baseUrl: env.VITE_OAT_BASE_URL || '/oat',
      paths: parsePaths(env.VITE_OAT_PATHS),
    },
  };
}
