import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { readConfig } from './config';
import { createServices, ServicesProvider } from './services';
import './styles/app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ServicesProvider services={createServices(readConfig())}>
      <App />
    </ServicesProvider>
  </StrictMode>,
);
