/**
 * Capacitor configuration — the Android shell.
 *
 * Notable choices, and why:
 *  - `androidScheme: 'http'` → the app is served from `http://localhost`, so a
 *    plain-HTTP router UI is never blocked as mixed content, and WebView storage
 *    keeps a stable origin. Router calls themselves go through the native HTTP
 *    bridge, which is not subject to WebView CORS at all.
 *  - `CapacitorHttp.enabled: false` → we call `CapacitorHttp.request()` directly
 *    for router traffic and keep the WebView's own `fetch` untouched, so the
 *    UI's in-process `/api/*` calls stay byte-for-byte the same as on the web.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 * محمد إبراهيم أبو العز
 */

import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.abuelaz.universalroutermanager',
  appName: 'مدير الراوتر الشامل',
  webDir: '../web/dist',
  bundledWebRuntime: false,
  android: {
    allowMixedContent: true,
    captureInput: false,
    webContentsDebuggingEnabled: false,
  },
  server: {
    androidScheme: 'http',
    cleartext: true,
  },
  plugins: {
    CapacitorHttp: { enabled: false },
  },
};

export default config;
