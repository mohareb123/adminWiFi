# Core engine & local bridge — `@urlm/core` and `@urlm/bridge`

> © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved. · **ABU ELAZ ULTRA MAN**

## 1. `@urlm/core` — the portable engine

Plane: pure TypeScript, ESM, **no DOM and no Node-only modules**. Everything that touches a
network goes through an injected transport, which is what allows one codebase to drive real
hardware, simulated hardware, and Android later.

### 1.1 Facade: `UniversalRouterEngine`

`packages/core/src/router_engine/engine.ts`

| Method | Purpose |
| --- | --- |
| `discover(options?)` | Find candidate gateways on the local network (budgeted scan). |
| `fingerprint(target?, signals?)` | Run the fingerprint pipeline and return ranked candidates + confidence. |
| `connect(target, credentials, options?)` | Resolve the adapter, authenticate, load the session and snapshot. |
| `getSnapshot()` | Devices, Wi-Fi bands, WAN state, counters, capabilities. |
| `scanWifiNeighbors()` | Nearby SSIDs with channel/band/RSSI for the analyzer. |
| `getBandwidthSample()` | Incremental ↑/↓ counters (delta-based, not cumulative). |
| `getAdvancedData()` | QoS/DNS/DHCP/firewall/port-forwarding/logs for Advanced Mode. |
| `execute(request)` | Perform one operation and verify it. |
| `reboot()` · `logout()` | Lifecycle helpers with confirmation + verification rules. |
| `speedTest(options)` | PING → DOWNLOAD → UPLOAD with real phase callbacks (`onPhase`). |

### 1.2 Fingerprinting

* `fingerprinting/engine.ts` — signal collection with a strict request/time budget, TLS info,
  UPnP/TR-064 description, optional SNMP (only if already permitted), DHCP hints.
* `fingerprinting/matcher.ts` — weighted scoring; requires corroboration across signal families
  before it will report high confidence. Damped API-path scoring where the response must
  *look like data* (`looksLikeData()`) so soft-404 pages score ×0.2 instead of matching.
* Output: `FingerprintReport { best, candidates[], evidence[], signals, confidence }`, where
  confidence quality is classified `exact | high | medium | low | unknown`.

### 1.3 Signatures

`RouterSignatures` (`signatures/database.ts`, entries in `signatures/builtin.ts`, OUI table in
`signatures/oui.ts`) stores, per router family:

`vendor · model patterns · firmware patterns · login type · management URL · auth method ·
capabilities · API/UI selectors · adapter id · confidence weight`

The database is **updateable at runtime** — `loadPack()` / `exportPack()` accept external packs
(JSON), so new router families can be added through the UI or a file **without rebuilding the
app**. `recordLearned()` keeps user-confirmed detections separate from shipped packs.

### 1.4 Adapters

`adapters/base.ts` holds `BaseRouterAdapter` (login recipes, HTML/JSON read-back, TR-069 value
extraction, list parsing). Shipped adapters live in `adapters/vendors.ts`:

| Adapter | Covers | Notes |
| --- | --- | --- |
| `GenericRouterAdapter` | anything unknown | Safe, read-mostly; the deliberate fallback for low confidence. |
| Huawei (HG-series / HiLink) | home gateways + HiLink | Form POST login, TR-069 dump parsing, device block/rename, Wi-Fi set. |
| ZTE (F6xx / ZXHN) | ISP-supplied gateways | `Frm_Username`/`Frm_Password` login, indexed TR-069 paths. |
| TP-Link (Archer / legacy) | Archer Web UI + legacy CGI | Token/session login, CGI writes, HTML read-back. |
| D-Link | DIR/DSL families | Session login, CGI operations where exposed. |

Parsing helpers (`adapters/parsing.ts`) cover TR-069 key/value dumps (`extractLanFromFields`),
JSON and HTML tables, so an adapter can degrade to *read-only but honest* when a firmware
changes its markup. Connection inference reports `wifi`, `wifi-2.4`, `wifi-5`, `ethernet` or
`unknown` — it never guesses a band it did not observe.

### 1.5 Capabilities, verification, honesty

* `capabilities/detector.ts` produces the `supported | unsupported | unknown` matrix used by the
  UI to hide/disable actions. Supported is only claimed when it was observed on this session.
* `verification/engine.ts` classifies every write: `verified`, `accepted-unverified`, `failed`.
  The engine returns an Arabic reason with the technical detail attached for Advanced Mode.
* `smart_fix/engine.ts` implements Detect → Analyze → Recommend → Confirm → Apply → Verify.
* `smart_fix/assistant.ts` maps Arabic natural-language intents («النت بطيء»,
  «عايز أقفل النت عن الجهاز ده», «مين أكتر جهاز بيستهلك النت؟», «عايز أغير باسورد الواي فاي», …)
  into a concrete proposal the user taps to apply. Nothing is applied from text alone.

### 1.6 Simulators

`simulated/` contains real (if simplified) router behaviours: `state.ts` (mutable device/band
state), `profiles.ts` (Huawei HG8145, ZTE F660, TP-Link Archer, D-Link DIR, …), `shapes.ts`
(HTML/CSS/JS login-page shapes used by the fingerprint engine), and `transport.ts`, which
implements the same transport contract as the real HTTP transport. The demo backend therefore
exercises the *production* code path end to end — fingerprint → auth → snapshot → operation →
verification → speed test — instead of a mock screen. Their serialized payloads stay ≤ 22 MB.

## 2. `@urlm/bridge` — the local bridge

Plane: Node (tsx), loopback by default, serves the built SPA and the `/api/*` surface.

### 2.1 Security posture

* Binds `127.0.0.1` unless explicitly told otherwise. A non-loopback request without a matching
  `x-urlm-token` header is rejected with **403** and an Arabic explanation body.
* Credentials are held in `EncryptedCredentialVault` — AES-256-GCM, key file mode `0600`, files
  `"<iv>.<tag>.<ciphertext>"`. Tampering fails **closed** (decryption returns nothing rather
  than throwing secrets around).
* Router metadata lives in `SavedRouterStore` (`routers.json`), which is metadata-only — no
  passwords. `--no-persist` keeps the whole vault in memory (`kind: 'session-only'`).
* Paths: `$URLM_HOME ?? ~/.universal-router-manager` → `{root, secret, credentials, routers,
  settings}`. Nothing is written outside that root.

### 2.2 HTTP surface

| Route | Method | Returns |
| --- | --- | --- |
| `/api/health` | GET | App name, component, developer attribution, copyright. |
| `/api/state` | GET | Full UI state: state + describe + session + snapshot + security + signatures + learned + vault status. |
| `/api/snapshot` | GET | Devices/bands/WAN snapshot only (cheap poll). |
| `/api/connect` | POST | Connect to a target with credentials (or a saved router id). |
| `/api/operations` | POST | Execute one operation; response includes `verification` + fresh `snapshot`. |
| `/api/assistant` | POST | `{ text }` → intent + Arabic reply + optional plan for «تطبيق الحل». |
| `/api/stream` | GET | SSE: state/notification/snapshot events. |
| `/api/speedtest/plan` | GET | The plan the UI will show *before* measuring. |
| `/api/speedtest/stream` | GET | SSE with real `phase` → `sample` → `result` events (no fake animation). |
| `/api/routers/label` | GET | Saved routers + rename/forget helpers. |
| `/api/export` | GET | Backup JSON (settings, routers metadata, learned fingerprints — never secrets). |

Operation result shape:

```json
{ "ok": true,
  "verification": { "outcome": "verified" },
  "snapshot": { "devices": [], "bands": [] } }
```

## 3. Testing

| Suite | Command | Status |
| --- | --- | --- |
| Core | `npx vitest run --root packages/core` | 56 passing (fingerprint, adapters, engine, simulators, security, smart fix, verification). |
| Bridge | `cd packages/bridge && npx vitest run` | 16 passing (`server.test.ts` route/SSE/auth boundaries, `vault.test.ts` crypto + store). |
| Web | `cd packages/web && npx vitest run` | 15 passing (component + user-flow tests in jsdom). |
| Type checks | `npm run typecheck` | clean across core/bridge/web (including test tsconfigs). |

Run everything: `npm run test:all`.

The bridge tests deliberately cover the unglamorous parts that protect users: credentials never
appear in redacted state payloads, the vault writes no plaintext, `routers.json` matches no
`/password/i`, and a non-loopback request without a token is refused.
