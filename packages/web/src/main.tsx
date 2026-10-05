/**
 * Entry point.
 *
 * Registers the offline service worker (production only: dev servers must never
 * be cached) and mounts the application. The React root is the only global the
 * app touches.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { isNativeShell } from './core/runtime';
import './styles/base.css';
import './styles/ui.css';
import './styles/panels.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Remove the inline boot splash once React has painted.
requestAnimationFrame(() => document.getElementById('boot')?.remove());

// The PWA shell cache is a browser feature. Inside the APK the assets are
// already local, and a stale shell cache would delay app updates — so on device
// we make sure no service worker is left behind.
if ('serviceWorker' in navigator) {
  if (isNativeShell()) {
    void navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) void registration.unregister();
    });
  } else if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    });
  }
}
