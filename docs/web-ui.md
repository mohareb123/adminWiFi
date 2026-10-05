# Web UI (PWA) — `packages/web`

> © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved. · **ABU ELAZ ULTRA MAN**

React 18 + Vite 5, Arabic-first RTL, installable as a PWA. The UI is a **presentation layer
only**: every fact it shows comes from the bridge, and every claim of success comes from the
verification engine. It never talks to a router directly.

## 1. Screen flow

```
Splash (short, glow + network lines, skippable)
   └─► DeveloperWelcome (once per profile, links never auto-open)
         └─► ConnectScreen ──► SimpleDashboard ──► panels
```

* **Splash** — `components/Splash.tsx`. Exists to hide session hydration, not to delay the user.
* **DeveloperWelcome** — `components/DeveloperWelcome.tsx`. Developer identity + subscribe
  buttons (YouTube, WhatsApp Channel) + «متابعة». URLs come from env
  (`VITE_YOUTUBE_URL`, `VITE_WHATSAPP_URL`); a tap is always required.
* **ConnectScreen** — `components/ConnectScreen.tsx`. User sees only *اسم المستخدم*,
  *كلمة المرور*, *تسجيل الدخول*, demo profiles, and saved routers. The login method
  (form/session/token/HTTP auth), the adapter and the fingerprint live behind Advanced Mode.

## 2. Panels

`type PanelId = 'home' | 'devices' | 'wifi' | 'map' | 'bandwidth' | 'speed' | 'security' |
'assistant' | 'advanced' | 'settings' | 'about'`

| Panel | File | Highlights |
| --- | --- | --- |
| `home` | `SimpleDashboard.tsx` | Internet state orb, ↓/↑ speed, device count, Wi-Fi summary, quick actions (الأجهزة / Wi-Fi / اختبار السرعة / إعدادات الراوتر), lazy network map. |
| `devices` | `DevicesPanel.tsx` | Device cards: name, IP, MAC, connection, signal, ↓/↑ usage, actions (إيقاف/استئناف, تحديد السرعة, تغيير الاسم, معلومات). |
| `wifi` | `WifiPanel.tsx` | SSID/password/band/channel/security/guest, plus the analyzer (nearby networks, channel congestion). 5 GHz controls are hidden when the router reports no 5 GHz radio. |
| `map` | `NetworkMap.tsx` | Canvas network map: router centred, devices around it, packet particles whose velocity tracks measured traffic. |
| `bandwidth` | `BandwidthPanel.tsx` | Live incremental graphs, top consumers, per-device bars. |
| `speed` | `SpeedTestPanel.tsx` | PING → DOWNLOAD → UPLOAD with a real phase stream from `/api/speedtest/stream`, animated gauge, final figure (e.g. `42.8 Mbps`). |
| `security` | `SecurityPanel.tsx` | 🟢 آمن / 🟡 يحتاج انتباهاً / 🔴 خطر — weak security, open guest network, unsafe settings, unknown devices, firmware awareness. |
| `assistant` | `AssistantPanel.tsx` | Arabic chat: intent → explanation → concrete proposal → **[ تطبيق الحل ]**. |
| `advanced` | `AdvancedPanel.tsx` | QoS, DNS, DHCP, Firewall, Port Forwarding, WAN/LAN, logs, capability matrix, fingerprint report, adapter info, raw preferences JSON. |
| `settings` | in `App.tsx` | Simple/Advanced switch, accessibility prefs, notification toggles, quality override, multi-router list, backup/restore/export/import. |
| `about` | `AboutPanel.tsx` | Name, version, developer, copyright, OSS licences, capabilities, diagnostics, privacy statement. |
| notifications | `NotificationsPanel.tsx` | Bell popover — new device, speed drop, disconnect, Smart Fix applied. |

Panels are `lazy()` chunks. Once visited they stay mounted and are hidden with `hidden` so
switching tabs is instant and panel state (scroll, form, chart buffers) survives.

## 3. Store and data flow

`src/core/store.ts` is a tiny external store consumed through `useAppState(selector)`.

* Actions: `bootstrap`, `dispose`, `setMode`, `refreshSnapshot`, `execute(id, params, confirm?)`,
  `applyPlan`, `ask(text)`, `loadNeighbors(force?)`, `runSpeedTest`, `connectSaved`,
  `forgetRouter`, `renameRouter`, `markNotificationsRead`.
* Slices: `bridge, host, phase, session, snapshot, samples, monitor, describe, security,
  neighbors, neighborsLoading, speedTest, speedPlan, assistant, assistantBusy, notifications,
  unreadNotifications, routers`.
* Live channels: `/api/stream` (state + notifications) and `/api/speedtest/stream` (phases and
  samples). Both are plain `EventSource`; no polling loop anywhere.
* Updates are **incremental**: sample buffers append and are capped, so nothing repaints the
  whole dashboard on a tick.

## 4. Performance rules (`src/visual/`)

`VisualEngine` (`visual/visual-engine.ts`) picks a tier from cores, memory, `prefers-reduced-motion`,
`saveData`, pointer type and measured refresh rate, then keeps checking frame health:

| Tier | Target | Particles | Blur |
| --- | --- | --- | --- |
| `ultra` | 120 FPS | 64 | 26 px |
| `high` | 60 FPS | 44 | 20 px |
| `balanced` | 60 FPS | 26 | 12 px |
| `lite` | 30 FPS | 12 | 0 |

It downgrades after 3 bad 1.2 s windows and re-promotes after 6 good ones, publishes
`documentElement.dataset.{quality,animations,gradients,glow,backdrop,reducedMotion,refresh}`
plus `--blur-strength` / `--particle-count`, and exposes `addTicker(id, cb, fps, priority)` so
canvas work is demand-driven rather than a permanent animation loop. Users can pin a tier via
`localStorage 'urlm.quality'` or the Settings panel.

Hard rules kept in the code: no network call on the main interaction path, no unbounded element
creation, no full-dashboard repaint on a timer, no animation that does not encode information.

## 5. Arabic-first copy and errors

`src/core/i18n.ts` groups all user-facing text (`app/splash/welcome/nav/simple/connect/loading/
devices/wifi/security/bandwidth/speed/dns/assistant/verification/capabilities/fingerprint/
automation/routers/backup/notifications/settings/about/advanced/common/errors`) plus
`phaseLabel(messageKey, fallback)` for stage-specific loading text and `OPERATION_LABELS`
(24 operation ids → Arabic labels). `TECH` holds the jargon that only Advanced Mode renders.

Errors are friendly and actionable in Simple Mode; the raw technical detail (status codes,
endpoint, body excerpt) appears in Advanced Mode only. Unsupported things say
«غير مدعوم على هذا الراوتر» instead of hiding silently — the user always gets an answer.

## 6. Accessibility and offline

* Large-text, high-contrast, reduced-motion and low-data toggles, persisted in
  `urlm.preferences.v1`.
* 44 px minimum touch targets, visible focus rings, `aria-live` on assistant replies and
  notification counts, decorative emoji wrapped in `aria-hidden`.
* `public/sw.js` + `manifest.webmanifest` give an installable shell: last known snapshot,
  saved routers and copy stay readable with no connection. Network-dependent actions show the
  honest offline state rather than spinning forever.

## 7. Tests

`tests/ui.test.tsx` (6) and `tests/flows.test.tsx` (9) run in jsdom with a stubbed
`EventSource`, covering splash → welcome → connect → dashboard, the demo-profile switch,
device actions, alerts, the speed-test flow and the assistant. Run with:

```bash
cd packages/web && npx vitest run
```
