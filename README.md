# Universal Router Manager

### مدير الراوتر الشامل — **Universal Router Adaptation System**

> **المطوّر:** محمد إبراهيم أبو العز — *Mohamed Ibrahim Abu El-Ezz*
> **الهوية:** ABU ELAZ ULTRA MAN
> **© 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.**

A professional router/network management app that adapts itself to the router it finds — instead
of forcing you to learn each vendor's menus. Arabic-first, verification-first, and built so it
*feels lighter than it looks*.

**الإصدار 1.0.0** · Web (PWA) + local bridge + **تطبيق أندرويد (APK)** — [تحميل الـ APK من صفحة الإصدارات ›](../../releases)

---

## Why it is different

| Ordinary management app | Universal Router Manager |
| --- | --- |
| Written for one vendor, breaks on the next | **Universal adaptation**: fingerprints the router from many signals and picks the best available adapter. |
| Guesses when it does not recognise the device | **Honest confidence**: shows `Huawei HG8145P5 — 98%`, and at low confidence says «تم التعرف على الراوتر بثقة محدودة» then uses a safe generic adapter. |
| Shows buttons that do nothing | **Capability gating**: no button unless it is reliably supported; otherwise «غير مدعوم على هذا الراوتر». |
| Says "Done" and hopes | **Verification engine**: every change is read back before success is reported. Real success «✓ تم تطبيق الحل بنجاح», honest failure «⚠️ لم يتم تطبيق التغيير. السبب: …». |
| Sends your network data to a cloud | **Local-first**: the bridge runs on your machine; credentials are encrypted; nothing about your private network leaves home without consent. |

---

## Features

### Simple Mode — for everyone
* **Splash → Welcome → Connect → Dashboard**: the user only ever sees *اسم المستخدم*, *كلمة المرور*
  and *تسجيل الدخول* — the login *mechanism* (form / session / token / HTTP auth / cookie) is
  handled underneath.
* Dashboard: Internet state, ↓/↑ speed, connected-device count, Wi-Fi summary, and quick actions
  **الأجهزة · Wi-Fi · اختبار السرعة · إعدادات الراوتر**.
* **Device Manager** — every device with name, IP, MAC, connection type, signal, usage and
  actions: إيقاف/استئناف الإنترنت، تحديد السرعة، تغيير الاسم، معلومات الجهاز.
* **Animated Network Map** — router in the centre, devices around it, packet particles whose
  speed matches real traffic.
* **Bandwidth Manager** — real-time incremental graphs, top consumers.
* **Wi-Fi Manager & Analyzer** — SSID, password, 2.4/5 GHz, channel, security, guest network;
  nearby networks, channel congestion. 5 GHz is hidden when the router has no 5 GHz radio.
* **Speed Test** — PING → DOWNLOAD → UPLOAD with a live gauge and a final real figure.
* **Internet Monitor** — latency, packet loss, connection state.
* **Security Center** — 🟢 آمن / 🟡 يحتاج انتباهاً / 🔴 خطر (weak security, open guest network,
  unsafe settings, unknown devices, firmware awareness).
* **Smart Assistant** — ask in Arabic: «النت بطيء»، «عايز أقفل النت عن الجهاز ده»،
  «مين أكتر جهاز بيستهلك النت؟»، «عايز أغير باسورد الواي فاي» — and get a concrete proposal with
  **[ تطبيق الحل ]** that runs Detect → Analyze → Recommend → Confirm → Apply → Verify.
* **Notifications** — new device, speed drop, disconnect, Smart Fix applied.

### Advanced Mode — for professionals (switch any time)
QoS, DNS (with presets), DHCP pool/lease, firewall level, port forwarding, WAN (MTU, reconnect),
LAN, logs, diagnostics, the **capability matrix**, the **fingerprint report**, adapter
information, multi-router management, backup (create/restore/export/import — restore only after
an explicit confirmation), automation rules, and the full technical detail of every error.

### Non-negotiable engineering rules
* Performance priority: **Correctness → Responsiveness → Smoothness → Reliability → Visuals**.
* No heavy work on the UI thread, no full repaint per tick, no unbounded animation; the adaptive
  visual engine targets 60 FPS on mid-range devices and 90/120 FPS where the hardware allows.
* Loading text is stage-specific (`جاري اكتشاف الراوتر…`, `جاري تحليل الشبكة…`,
  `جاري التحقق من الإمكانيات…`, `جاري تسجيل الدخول…`, `جاري التحقق…`) — never a bare "Loading…".
* Accessibility: large text, high contrast, reduced motion, screen-reader labels, touch-friendly
  targets; offline-first shell so the last known state stays readable.

---

## APK — التطبيق الكامل على الهاتف (بدون كمبيوتر)

**حمّل الـ APK:** افتح **Releases → `apk-latest`** في هذا المستودع، ونزّل
`universal-router-manager-1.0.0.apk`، ثم ثبّته على هاتفك (اسمح بالتثبيت من مصادر غير معروفة
مرة واحدة).

ماذا يعني «كامل» هنا؟ **المحرّك نفسه يعمل داخل الهاتف**:

* لا جسر محلي ولا سيرفر ولا كمبيوتر — التطبيق يتصل بالراوتر الحقيقي من الهاتف عبر شبكة الواي فاي.
* نفس المحرّك والشاشات والنصوص: الاكتشاف، التعرّف على الراوتر (Fingerprint + Confidence)،
  تسجيل الدخول بكل طرقه، الأجهزة، الواي فاي، تحليل القنوات، الأمان، المساعد الذكي، Smart Fix،
  اختبار السرعة، والتحقق من كل تغيير قبل إعلان النجاح.
* **الوضع التجريبي يعمل فورًا وبدون إنترنت** (راوترات محاكاة: Huawei / ZTE / TP-Link / D-Link /
  OpenWrt) لتجربة كل شيء بأمان، وبديل «الوضع الحقيقي» لشبكتك.
* كلمة المرور المحفوظة تُشفَّر بمفتاح داخل **Android Keystore** — لا نص صريح ولا نسخ احتياطي للأسرار.
* قياس سرعة الإنترنت (رفع/تنزيل من خادم عام) **يحتاج موافقتك** من شاشة اختبار السرعة؛ الافتراضي
  قياس محلي بين الهاتف والراوتر ولا يخرج أي شيء من الشبكة.
* يُبنى الـ APK تلقائيًا على GitHub Actions مع كل تحديث وينشر نفسه في الإصدارات.

المزيد: [`docs/ANDROID.md`](docs/ANDROID.md) · الأذونات والحدود المعروفة وتوقيع الإصدار موضّحة هناك بالتفصيل.

## Quick start

```bash
npm install                 # npm workspaces: core · bridge · web

# 1) start the local bridge (simulated routers by default — safe to try)
npm run dev:bridge          # 127.0.0.1:8787

# 2) start the web app
npm run dev:web             # http://localhost:5173
```

Open the app, keep the default demo profile (Huawei HG8145P5, `admin` / `Admin@123`) or pick
ZTE / TP-Link / D-Link / OpenWrt, and press **تسجيل الدخول**.

**Connect to a real router** (same machine, same LAN, network you own or are authorised to
administer):

```bash
npm run dev:bridge -- --real     # reads the OS gateway, talks to the router's admin UI
```

Production build (the bridge serves the built SPA):

```bash
npm run build && npm start
```

Verify the work:

```bash
npm run typecheck     # core + bridge + web + mobile (including test tsconfigs)
npm run test:all      # core 64 · bridge 16 · web 20 tests
npm run build:apk     # a real APK, locally (needs JDK 17 + Android SDK)
```

---

## Architecture in one picture

```
packages/web      React 18 + Vite 5 PWA   — presentation only, never touches a router
      │  HTTP/JSON + SSE  (relative /api/*)
      ├────────────────────────────┬──────────────────────────────────────────┐
      ▼                            ▼                                          │
packages/bridge   Node bridge      APK: in-process engine host (packages/mobile)
  encrypted vault · routes · SSE     CapacitorHttp · Android Keystore vault
      │  in-process                            │
      └────────────────┬───────────────────────┘
                       ▼
packages/core     Portable engine — fingerprinting, adapters, capabilities,
                  verification, smart fix, devices, Wi-Fi, bandwidth, security,
                  host + /api route table (shared by bridge and APK)
```

* `packages/core` has **no DOM and no Node-only imports** — the same engine will run inside the
  Android layer later, unchanged.
* The browser is never asked to reach `127.0.0.1`: it calls relative `/api/*`, which Vite proxies
  in development and the bridge serves in production.
* Credentials are held in an AES-256-GCM vault (key file mode `0600`, no plaintext on disk) with
  a *Remember this router* opt-in.

Full details: [`docs/architecture.md`](docs/architecture.md).

---

## Router support

<table>
<tr><th>Family</th><th>Typical models</th><th>Login</th><th>What works (when observed)</th></tr>
<tr><td>Huawei</td><td>HG8145 / HG8245 / HG8247, HiLink</td><td>form POST</td><td>devices (list/block/rename), Wi-Fi, WAN reconnect, reboot, backup</td></tr>
<tr><td>ZTE</td><td>F660 / F670 / ZXHN H288A</td><td>Frm_Username POST</td><td>devices (list/block), Wi-Fi, reboot</td></tr>
<tr><td>TP-Link</td><td>Archer (new UI), legacy CGI</td><td>token/session</td><td>devices, Wi-Fi, channel, reboot</td></tr>
<tr><td>D-Link</td><td>DIR / DSL families</td><td>session</td><td>Wi-Fi, reboot, partial device list</td></tr>
<tr><td>Anything else</td><td>—</td><td>discovered recipe</td><td><code>GenericRouterAdapter</code>: identity, snapshot, Wi-Fi read, diagnostics</td></tr>
</table>

New families are added as **signature packs** (loadable at runtime, no rebuild) plus an adapter
and a simulator profile. Support matrix, simulators, credentials and known limits:
[`docs/routers.md`](docs/routers.md).

*(The demo profiles are simulated routers that exercise the exact production code path —
fingerprint → auth → snapshot → operation → verification → speed test.)*

---

## Documentation

| Document | Contents |
| --- | --- |
| [`docs/architecture.md`](docs/architecture.md) | Packages, layers, request lifecycle, fingerprint pipeline, capability gating, UI rules. |
| [`docs/ANDROID.md`](docs/ANDROID.md) | **APK**: download/install, on-device engine, permissions, signing, known limits. |
| [`docs/web-ui.md`](docs/web-ui.md) | Screen flow, panels, store, performance tiers, Arabic copy, accessibility, offline. |
| [`docs/bridge-core.md`](docs/bridge-core.md) | Engine facade, fingerprinting, adapters, capabilities, verification, bridge API + security. |
| [`docs/routers.md`](docs/routers.md) | Support matrix, simulators, real-hardware usage, known limits. |
| [`docs/THIRD-PARTY.md`](docs/THIRD-PARTY.md) | Dependency licences, bundled assets, rules we hold ourselves to. |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Setup, layout, non-negotiables, how to add a router family. |
| [`NOTICE`](NOTICE) | Ownership, permitted use, prohibited use. |

---

## Roadmap

1. **Web (PWA) + local bridge** — done: real engine, simulators, real-hardware mode, 79 tests.
2. **Android APK** — done: the portable engine runs on the phone, Keystore-sealed credentials,
   automatic GitHub Actions build + release. Next: background monitoring and home-screen widgets.
3. **Community signature packs** — import/export packs so new ISP gateways can be supported
   without shipping a new build.

---

## Safety, privacy and legal

* Use this app **only on networks you own or are explicitly authorised to administer**.
* The engine performs **safe, bounded discovery**: no brute force, no credential attacks, no
  login bypass, no exploitation, no firmware extraction or reverse engineering.
* Router management happens through the router's own user-facing administration interface.
* No credentials in logs, no credentials in backups, no private-network data sent anywhere
  without the user's explicit consent.
* Vendor names and trademarks belong to their owners; this project claims no ownership of vendor
  firmware, APIs or trademarks.

**© 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.**
محمد إبراهيم أبو العز · **ABU ELAZ ULTRA MAN**
