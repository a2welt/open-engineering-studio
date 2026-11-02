import { createContext, useContext, type ReactNode } from 'react';

import { HttpOatClient } from './api/oat/http';
import { MockOatClient } from './api/oat/mock';
import type { OatClient } from './api/oat/types';
import { HttpXrayClient, SampleXrayClient } from './api/xray/client';
import type { XrayClient } from './api/xray/types';
import type { StudioConfig } from './config';

export interface Services {
  /** Clients to try in order: live X-Ray first (unless mocked), then the bundled sample. */
  xray: XrayClient[];
  oat: OatClient;
}

export function createServices(config: StudioConfig): Services {
  const live = new HttpXrayClient(config.xray.baseUrl);
  const sample = new SampleXrayClient();
  const xray =
    config.xray.mode === 'mock' ? [sample] : config.xray.mode === 'http' ? [live] : [live, sample];
  const oat =
    config.oat.mode === 'http'
      ? new HttpOatClient(config.oat.baseUrl, config.oat.paths)
      : new MockOatClient();
  return { xray, oat };
}

const ServicesContext = createContext<Services | null>(null);

export function ServicesProvider({ services, children }: { services: Services; children: ReactNode }) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('useServices needs a ServicesProvider');
  return services;
}
