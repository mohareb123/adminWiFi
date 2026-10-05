# Contributing & development guide

> © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved. · **ABU ELAZ ULTRA MAN**

Thanks for helping Universal Router Manager support more routers. This guide is short on
purpose: the rules below are the ones that keep the product honest and fast.

## 1. Setup

```bash
npm install                 # npm workspaces: core · bridge · web · mobile
npm run dev:bridge          # local bridge on 127.0.0.1:8787  (add -- --real for hardware)
npm run dev:web             # Vite dev server on 0.0.0.0:5173, proxies /api → the bridge
npm run build:apk           # a real installable APK (JDK 17 + Android SDK required)
```

Useful single commands:

| Task | Command |
| --- | --- |
| Type-check everything | `npm run typecheck` |
| All test suites | `npm run test:all` |
| Core tests only | `npm run test` |
| Bridge tests | `cd packages/bridge && npx vitest run` |
| Web tests | `cd packages/web && npx vitest run` |
| Production build | `npm run build` |
| Android APK (local) | `npm run build:apk` |
| On-device runtime test | `cd packages/web && npx vitest run tests/device.test.ts` |

## 2. Repository layout

```
packages/core     portable engine (no DOM, no Node globals) + host + /api route table
packages/bridge   local Node bridge: vault, Node platform, SSE, static hosting
packages/web      React PWA UI + the runtime switch (bridge ⇄ on-device)
packages/mobile   Android shell: Capacitor config, Java companion plugin, Gradle project
docs/             architecture, UI, engine/API, routers, Android, licences
```

Both the bridge and the APK must keep proving the *same* `/api/*` contract: if you add a route,
add it to `packages/core/src/host/router.ts` (once) and cover it in `packages/core/tests/host.test.ts`.
The APK path additionally has to stay green in `packages/web/tests/device.test.ts`.

Module separation inside `core` mirrors the spec and must be respected: `core/ router_engine/
fingerprinting/ signatures/ adapters/ authentication/ capabilities/ devices/ wifi/ bandwidth/
qos/ security/ automation/ smart_fix/ verification/ performance/ storage/ transport/ ui/
diagnostics/ simulated/`.

## 3. The non-negotiables

1. **No fake success.** A write is only reported as successful after a read-back agrees, or via
   an explicitly documented `accepted-unverified` path. New operations must state which one
   they are and be covered by a test.
2. **No unsupported buttons.** If the capability matrix says `unsupported` or `unknown`, the UI
   must say «غير مدعوم على هذا الراوتر» or disable the action with a reason.
3. **Safe discovery only.** No brute force, no credential attacks, no login bypass, no
   exploitation code. Probes must be few, slow and respectful; respect the request budget.
4. **Smoothness beats effects.** No blocking network call on the interaction path, no unbounded
   element creation, no full-panel repaint on a tick, no animation without informational value.
   Target 60 FPS on mid-range devices and degrade gracefully.
5. **Privacy.** Credentials never leave the encrypted vault and never enter logs. Nothing about
   the user's private network is sent anywhere without explicit consent.
6. **Arabic-first UX**, with technical vocabulary confined to Advanced Mode.
7. **Portable core.** `packages/core` may not import `node:*` or touch the DOM. Use the transport
   interface instead.

## 4. Adding a router family

1. Add a `SignatureEntry` to `packages/core/src/signatures/builtin.ts` (vendor, model patterns,
   firmware patterns, login type, management URL, auth method, capabilities, API/UI selectors,
   adapter id, confidence) — or ship it as an external pack JSON, which requires no rebuild.
2. If the family needs new request shapes, extend an existing adapter in `adapters/vendors.ts`
   or add one deriving from `BaseRouterAdapter`; keep parsing helpers in `adapters/parsing.ts`.
3. Declare capabilities conservatively; mark each operation `verified` or
   `accepted-unverified` behaviour explicitly in `verification/engine.ts` terms.
4. Add a simulator profile in `simulated/profiles.ts` (realistic login/management markup,
   including a soft-404 trap) so the whole path is testable without hardware.
5. Add tests: fingerprint scoring, auth recipe, at least one operation with verification, and
   the honest failure path.
6. Generate docs before adding features. Any new architecture concept must be documented in
   `docs/architecture.md` or `docs/routers.md` and referenced from `README.md`.

## 5. Style

* TypeScript strict, ESM, no `any` without a comment explaining why.
* Prefer pure functions in `core`; side effects stay at the edges (`bridge`, `web`).
* User-facing strings are added to `packages/web/src/core/i18n.ts` — never inlined into JSX.
* Comments and identifiers in English; **user-facing copy in Arabic**; developer attribution
  headers preserved at the top of source files:
  «محمد إبراهيم أبو العز / Mohamed Ibrahim Abu El-Ezz».
* Tests describe behaviour ("says غير مدعوم when the capability is unknown"), not implementation.

## 6. Commit & PR checklist

- [ ] `npm run typecheck` clean
- [ ] `npm run test:all` green
- [ ] New behaviour covered by tests; honest-failure path included
- [ ] No new telemetry, no new external calls, no new credentials in logs
- [ ] Docs updated (README and/or `docs/*`)
- [ ] Attribution intact (NOTICE, package metadata, UI About screen)
