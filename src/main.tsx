import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {ErrorBoundary} from './components/ErrorBoundary.tsx';
import './index.css';
import {watchForNewVersion} from './lib/updateWatch.ts';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

// an installed app can stay open on an old build for days: offer a reload when a new one is live
watchForNewVersion();

// PWA: register the service worker so the app installs on any device and the
// last live-tracking view survives a dropped connection.
if ('serviceWorker' in navigator && (import.meta as { env?: { PROD?: boolean } }).env?.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[PWA] service worker registration failed:', err);
    });
  });
}
