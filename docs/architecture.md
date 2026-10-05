# Architecture — Universal Router Manager

> © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
> Universal Router Manager — **ABU ELAZ ULTRA MAN**

The system is split into three independent packages. The split exists for one reason: **the
router logic must never depend on the screen**. The same core that powers the Web/PWA build
today will power the Android shell tomorrow, unchanged.

```
┌───────────────────────────────────────────────────────────────────────┐
│  packages/web      React 18 + Vite 5  (PWA, Arabic-first RTL)         │
│  UI · Visual engine · Assistant composer · Offline caches             │
└───────────────▲───────────────────────────────────────────────────────┘
                │  HTTP/JSON  +  Server-Sent Events   (relative `/api/*`)
                │  the browser NEVER talks to a router directly
┌───────────────┴───────────────────────────────────────────────────────┐
│  packages/bridge   Node/tsx local bridge (loopback by default)        │
│  Encrypted vault · Route table · SSE fan-out · Simulated backend      │
└───────────────▲───────────────────────────────────────────────────────┘
                │  in-process import (same process, no IPC hops)
┌───────────────┴───────────────────────────────────────────────────────┐
│  packages/core   Portable engine — zero DOM, zero Node-only globals  │
│  Engine · Fingerprinting · Signatures · Adapters · Capabilities       │
│  Verification · Smart Fix · Devices · Wi-Fi · Bandwidth · Security    │
└───────────────────────────────────────────────────────────────────────┘
```

## 0. Two hosts, one engine

The engine has no idea where it runs. `HostPlatform` (`packages/core/src/host/types.ts`) injects
whatever the machine can provide, and `routeBridgeRequest()` (`packages/core/src/host/router.ts`)
defines the `/api/*` contract **once**:

| Host | Transport | Vault | System services | Used by |
| --- | --- | --- | --- | --- |
| `bridge` (Node) | raw sockets (`NodeHttpTransport`) | AES-GCM file vault, mode `0600` | OS routing table, ARP/OUI, SSDP, TCP probes | Web/PWA + desktop |
| `device` (Android) | `CapacitorHttp` (native, CORS-free) | Android Keystore sealing + app-private metadata | Android `ConnectivityManager`, socket probe, HTTP-fetched IGD description | the APK |

Consequences: the UI keeps calling relative `/api/*` on both platforms; the same
fingerprinting, adapters, capability gating and verification apply; and a device-only feature
never silently changes desktop behaviour (or vice versa).

## 1. Why a local bridge

A browser cannot open a raw TCP socket, cannot send SNMP, cannot read a TR-064/UPnP device
description without CORS cooperation, and cannot safely hold long-lived credentials. Rather
than weaken the product, the architecture keeps the network work where it belongs — on the
user's own machine — and keeps the browser as a pure presentation layer.

Consequences that shape the code:

* **Privacy by construction.** Credentials enter the vault over loopback and are encrypted at
  rest. Nothing about the private network is uploaded anywhere.
* **No CORS games.** The device answers the bridge (server-to-server), so a router that sends
  no CORS headers still works.
* **One origin in the browser.** The UI only ever calls relative `/api/*`, which Vite proxies
  in development and the bridge serves in production. This is also what makes the hosted
  preview work: the preview host is never asked to reach `127.0.0.1`.
* **Portable core.** `packages/core` imports no `fs`, no `net`, no `child_process`. Its
  transport is an injected interface (`RouterTransport`), which is why the same code runs
  against real hardware, against simulators, and inside a future Android Kotlin/JS shell.

## 2. Layers inside `packages/core`

| Directory | Responsibility |
| --- | --- |
| `core/` ✔ | Cross-cutting primitives: types, errors, logger, HTTP wrapper, utilities, notification model. |
| `router_engine/` ✔ | `UniversalRouterEngine` (the façade), gateway discovery, speed-test orchestration. |
| `fingerprinting/` ✔ | `RouterFingerprintEngine` (signal collection) + `matcher` (scoring a candidate list). |
| `signatures/` ✔ | `RouterSignatures` database, built-in packs, OUI table, pack types/loader. |
| `adapters/` ✔ | `GenericRouterAdapter` + vendor adapters + parser helpers (TR-069, CGI, HTML). |
| `authentication/` ✔ | Login strategies: form POST, GET-with-credentials, token/session, HTTP auth, cookie probes. |
| `capabilities/` ✔ | `CapabilityDetector` — decides what is *reliably* supported for this exact router. |
| `verification/` ✔ | `VerificationEngine` — post-write read-back logic and outcome classification. |
| `security/` ✔ | Security centre findings (weak security, open guest net, unsafe settings, unknown devices, firmware). |
| `smart_fix/` ✔ | `SmartFixEngine` workflow and the Arabic intent assistant. |
| `diagnostics/` ✔ | Latency/loss monitor and the speed test. |
| `storage/` ✔ | Learning store, persistence interfaces, export/import helpers. |
| `simulated/` ✔ | Full router simulators (state machine, profiles, HTML/JS shapes, transport) used by the demo backend and by tests. |
| Device/Wi-Fi/traffic/QoS/automation domains | Delivered today through the engine (`getSnapshot`, `getBandwidthSample`, `getAdvancedData`, `execute`) and the panels that render them. They start as their own modules the moment they need state beyond the engine — the directory names are reserved per spec §49 and will not be renamed. |

(✔ = present in `packages/core/src` today.)

## 3. Request lifecycle (a change that must be *verified*)

```
UI action ─► bridge /api/operations ─► UniversalRouterEngine.execute(request)
   │                                            │
   │                                    1. resolve adapter + capability
   │                                            │
   │                                    2. build transport call(s)
   │                                            │
   │                                    3. write
   │                                            ▼
   │                                   VerificationEngine.readBack()
   │                                     ├── verified            → ✓ real success
   │                                     ├── accepted-unverified → honest "applied without read-back"
   │                                     └── failed              → ⚠ reason surfaced in Arabic
   ▼                                            │
snapshot + verification ◄───────────────────────┘
```

The contract is deliberately blunt: **no code path may report success it did not observe**.
`OperationResult.ok` is only `true` when the write went out *and* the read-back agreed, or when
the capability is explicitly marked "accepted unverified" for that adapter.

## 4. Fingerprinting pipeline

1. **Collect** (safe, non-aggressive, budgeted): gateway IP/MAC and OUI, HTTP response headers,
   login page structure, HTML/CSS/JS signatures, candidate API paths (probed with a strict
   request budget), device/firmware description, UPnP/TR-064 description, TLS certificate
   issuer/CN, DHCP lease hints, and — only when already permitted on the LAN — SNMP identity.
2. **Score**: each signal is weighted by *how much it discriminates*. A single match is never
   enough: vendor patterns alone can never produce a high score, and API-path noise is damped
   (`looksLikeData()` guard, ×0.2 weight) so soft-404 pages cannot fake a match.
3. **Decide**: `confidence` = combined evidence. At or above threshold the UI shows e.g.
   *Huawei HG8145P5 — 98%*. Below threshold the engine says
   *"تم التعرف على الراوتر بثقة محدودة"* and uses `GenericRouterAdapter` instead of guessing.
4. **Learn**: the fingerprint (never credentials) is appended to the learning store so the next
   scan is faster and more accurate. Learning never performs a dangerous change on its own.

## 5. Capability gating

`CapabilityDetector` answers three-state questions: *supported*, *unsupported*, *unknown*.
The UI renders a button only for `supported`; `unsupported` renders the Arabic label
«غير مدعوم على هذا الراوتر»; `unknown` renders a disabled action with an explanatory hint.
This is the mechanism that prevents the classic "button that does nothing" failure mode.

## 6. Presentation layer rules

* All values that can change arrive via **incremental updates**; no panel-wide re-render on a
  timer, no full repaint on a socket tick.
* Heavy work (fingerprinting, parsing, exports) runs off the interaction path; panels are
  `lazy()` chunks and stay mounted via `hidden` so switching tabs is instant and stateless.
* Canvas work is throttled by the **Visual Engine** tier (`ultra/high/balanced/lite`), which
  also honours `reducedMotion`, `saveData`, pointer type and measured frame health.
* Loading copy is always stage-specific (`جاري اكتشاف الراوتر…`, `جاري تحليل الشبكة…`,
  `جاري التحقق من الإمكانيات…`, `جاري تسجيل الدخول…`, `جاري التحقق…`) — never a bare
  "Loading…".

## 7. Feature-domain documents

* Web UI: [`web-ui.md`](./web-ui.md)
* Bridge, core engine and API: [`bridge-core.md`](./bridge-core.md)
* Support matrix, simulators and real hardware: [`routers.md`](./routers.md)
* Android APK: [`ANDROID.md`](./ANDROID.md)
* Build/run/test: [`../CONTRIBUTING.md`](../CONTRIBUTING.md)
* Third-party licences: [`THIRD-PARTY.md`](./THIRD-PARTY.md)
