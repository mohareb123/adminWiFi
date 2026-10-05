# Third-party software and licences

> Universal Router Manager — © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
> **ABU ELAZ ULTRA MAN**

Universal Router Manager is an independent product. It builds on the open-source projects below
and contains **no vendor firmware, no vendor source code and no vendor trademarks used as
branding**. Router and product names (Huawei, ZTE, TP-Link, D-Link, OpenWrt, …) are mentioned
only to describe compatibility, and all rights in them remain with their owners.

## Runtime dependencies

| Package | Version used | Licence | Purpose |
| --- | --- | --- | --- |
| `react` | 18.3.1 | MIT | UI runtime. |
| `react-dom` | 18.3.1 | MIT | DOM renderer. |
| `@urlm/core`, `@urlm/bridge`, `@urlm/mobile` | local workspace (`*`) | Proprietary (this project) | Engine, local bridge, Android shell. |
| `@capacitor/core` | 6.2.2 | MIT | Android shell runtime + native HTTP bridge (`CapacitorHttp`). |
| `@capacitor/android` | 6.2.2 | MIT | Capacitor's Android library (WebView bridge, plugin host). |
| `androidx.*` (appcompat, core-splashscreen, coordinatorlayout) | per `variables.gradle` | Apache-2.0 | Android support libraries pulled by the Capacitor template. |

## Build and test tooling (development only, not shipped in the app bundle)

| Package | Version used | Licence | Purpose |
| --- | --- | --- | --- |
| `vite` | 5.4.21 | MIT | Dev server / bundler. |
| `@vitejs/plugin-react` | 4.7.0 | MIT | React fast-refresh + JSX transform. |
| `esbuild` | 0.21.5 (via Vite) | MIT | Transpilation/minification. |
| `rollup` | 4.64.0 (via Vite) | MIT | Production bundling. |
| `typescript` | 5.9.x | Apache-2.0 | Type system and type-checking (`tsc --noEmit`). |
| `vitest` | 2.1.x | MIT | Test runner for core, bridge and web. |
| `jsdom` | 30.1.x | MIT | Browser environment for UI tests. |
| `@testing-library/react` / `@testing-library/dom` | 16.3.x / 10.4.x | MIT | Component and flow testing utilities. |
| `tsx` | 4.23.x | MIT | Runs the TypeScript bridge directly on Node. |
| `@capacitor/cli` | 6.2.2 | MIT | Generates/syncs the Android project (`cap sync android`). |
| `sharp` | 0.33.x | Apache-2.0 | Rasterises the brand SVG into Android launcher icons and splash screens (build time only; bundled with libvips — LGPL-3.0 for libvips itself). |
| Android Gradle Plugin / Gradle | 8.2.x / 8.2.1 | Apache-2.0 | Builds the APK in CI. |
| `@types/node`, `@types/react`, `@types/react-dom` | per lockfile | MIT | Type definitions. |

Versions above are the resolved versions in the committed lockfile; patch/minor updates inherit
the same licences. A full transitive list is available from `package-lock.json` (every entry
records its own licence field).

## Android build

The APK contains: the app's own compiled code, the Capacitor Android library, AndroidX
libraries, and the bundled web assets (HTML/CSS/JS/fonts — all generated from this repository).
It contains **no** vendor firmware, no vendor SDK, no third-party analytics or advertising
library, and no Google Play Services component. `sharp`/Gradle/AGP are build-time tools only and
are not shipped inside the APK.

## Bundled assets

| Asset | Origin | Licence |
| --- | --- | --- |
| `packages/web/public/icon.svg` | Created for this project | © 2026 Mohamed Ibrahim Abu El-Ezz |
| Fonts | None bundled — the UI uses system font stacks | — |
| Icons | Unicode/emoji glyphs only, no icon-font dependency | — |

## Web standards and protocols

The engine speaks standard, publicly documented protocols: HTTP/HTTPS, HTML/JS forms and
cookies, JSON REST, SOAP, TR-064/UPnP, DHCP/ARP-derived gateway information, and SNMP (only
where the network already exposes it). Protocol names and specifications belong to their
respective standards bodies and vendors; implementing them does not transfer any rights.

## Rules we hold ourselves to

1. We never claim ownership of vendor firmware, vendor APIs or vendor trademarks.
2. We do not bundle, extract or reverse-engineer vendor firmware or private vendor code.
3. We only interact with a router through its own, user-facing administration interface, on a
   network the user owns or is authorised to administer.
4. We do not implement brute force, credential attacks, login bypass or exploitation of any kind.
5. All diagnostic behaviour (fingerprinting, capability detection) is safe, bounded and
   observable — it never degrades the network it inspects.

If you believe a licence or attribution is missing or wrong, please open an issue and it will be
corrected promptly.
