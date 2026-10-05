# Android APK — the whole app, on the phone

> © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved. · **ABU ELAZ ULTRA MAN**

The Android build is not a shell around a website: **the full engine runs inside the phone**.
There is no desktop bridge, no PC, no local server, and no cloud service in the path.

```
APK
├── WebView  → the same React UI (Arabic-first, same screens, same copy)
│      │ in-process `/api/*`  (no socket, no CORS, no localhost)
│      ▼
├── Portable engine host  (packages/core/src/host — the very code the bridge runs)
│      │
│      ▼
├── Android native bridge (CapacitorHttp)  → real router management pages over Wi-Fi
│      └── companion plugin (Java): OS default gateway, socket latency probe,
│                                   Android Keystore sealing for saved passwords
└── Simulated routers built in (demo mode works offline, out of the box)
```

## 1. Download and install

1. Open the repository on GitHub → **Releases** → **`apk-latest`**.
2. Download `universal-router-manager-1.0.0.apk` (the debug file is there too, for developers).
3. On the phone: open the file → allow *install from unknown sources* once → install → open.
4. The app starts in **demo mode** (simulated Huawei HG8145P5: `admin` / `Admin@123`), so every
   screen can be explored without touching a real network.
5. For your own router: switch to **الوضع الحقيقي** (top bar → وضع التشغيل), make sure the phone
   is on that router's Wi-Fi, then sign in with the router's admin username and password.

APKs are built automatically by [`.github/workflows/android.yml`](../.github/workflows/android.yml)
on every push (`workflow_dispatch` also lets you re-run it by hand). No local Android SDK needed.

**Direct link:** <https://github.com/mohareb123/adminWiFi/releases/tag/apk-latest>

## 2. What works on the phone

| Area | On-device behaviour |
| --- | --- |
| Discovery | OS default gateway (Java plugin) first, then the engine's own bounded scan of common gateway addresses and admin ports. |
| Fingerprint + confidence | Full pipeline: HTTP headers, login page structure, HTML/JS/CSS signatures, API paths (with soft-404 damping), device/firmware description, TLS info, UPnP/TR-064 description XML, DHCP/OUI hints. Low confidence ⇒ «تم التعرف على الراوتر بثقة محدودة» + `GenericRouterAdapter`. |
| Login | All strategies (form POST, password-only, session, cookie, token, HTTP auth). The user only ever sees اسم المستخدم / كلمة المرور / تسجيل الدخول. |
| Devices, Wi-Fi, bandwidth, QoS, DNS, firewall, port forwarding, WAN/LAN, logs | Served by the same adapters and verified by the same verification engine. |
| Smart assistant + Smart Fix | Arabic intents → proposal → **تطبيق الحل** → Detect→Analyze→Recommend→Confirm→Apply→Verify. |
| Speed test | Latency uses real socket probes. Download is measured by moving real bytes from the router's own server (labelled *قياس محلي عبر الراوتر*) — nothing leaves your network. With explicit consent you can also measure the real internet line (upload included) against a public endpoint. Upload is never invented: it is either measured or reported as not measured. |
| Notifications, offline shell, saved routers | Local. Saved router metadata is app-private; the password (only if you tick *تذكّر هذا الراوتر*) is sealed by the Android Keystore. |
| Demo mode | Fully offline simulated routers (Huawei / ZTE / TP-Link / D-Link / OpenWrt). |

## 3. Permissions, and why each one exists

| Permission | Reason | Where it is used |
| --- | --- | --- |
| `INTERNET` | Reach the router's administration page on your LAN; optional internet speed measurement. | `capacitor-http.ts` |
| `ACCESS_NETWORK_STATE` | Read the OS default gateway and DNS so discovery starts from the truth. | `UrlmNativePlugin.info()` |
| `ACCESS_WIFI_STATE` | Show the current Wi-Fi link (frequency/link speed) in diagnostics. | `UrlmNativePlugin.info()` |

No location permission is requested (so the app deliberately cannot resolve the Wi-Fi SSID on
Android 10+ — the network *name* is not needed to manage a router). No camera, contacts,
storage-wide, phone or background-location permissions. No analytics, no ads, no telemetry.

Cleartext HTTP is permitted (`network_security_config.xml`) because home routers are http-only;
TLS verification is **not** disabled globally, and self-signed router certificates are reported
as a known limitation instead of being silently accepted.

## 4. Release signing

By default the workflow signs with the standard **debug keystore** — installable and fine for
personal use, but not upgradable from another key. To use your own key, add these repository
secrets (Settings → Secrets and variables → Actions):

| Secret | Meaning |
| --- | --- |
| `URLM_KEYSTORE_BASE64` | `base64 -w0 your-release.jks` |
| `URLM_KEYSTORE_PASSWORD` | Keystore password |
| `URLM_KEY_ALIAS` | Key alias (defaults to `urlm`) |
| `URLM_KEY_PASSWORD` | Key password |

The workflow decodes the keystore, and `app/build.gradle` picks it up automatically
(`URLM_KEYSTORE_FILE`). Keep the same keystore for future releases: Android only accepts an
update signed by the same key.

## 5. Build it yourself

```bash
npm install
npm run build -w @urlm/web          # the bundle the APK ships
npm run assets -w @urlm/mobile      # launcher icons + splash screens from the brand SVG
npm run build:apk                   # cap sync + gradlew assembleDebug
# output: packages/mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

Requirements: Node 20+, JDK 17, Android SDK (platform 34 + build-tools). On GitHub Actions all
three are set up by the workflow.

## 6. Known limits (stated, not hidden)

* **Self-signed HTTPS routers**: the native HTTP bridge uses the system trust store, so a router
  with a self-signed certificate may refuse HTTPS. Detection prefers the router's HTTP interface
  and the capability matrix reports the limitation rather than pretending.
* **SNMP**: the WebView has no UDP socket, so SNMP is declared unavailable on Android (it is used
  opportunistically by the desktop bridge only, and never to enable anything).
* **SSDP multicast**: the phone build reads IGD/TR-064 *description XML over HTTP* instead of
  sending SSDP M-SEARCH. A router that only answers multicast is reported as "no UPnP data".
* **Wi-Fi scanning (neighbouring networks)** requires the router itself to expose a survey
  endpoint; when it does not, the analyzer says so instead of inventing networks.
* **First connection** needs the phone on the router's Wi-Fi. A mobile-data connection cannot
  reach `192.168.x.x`, and the app says exactly that instead of failing silently.

## 7. How the build proves itself

Every CI build fails unless the packaged APK really contains what the app needs, and then
publishes that proof in the release notes:

* `assets/public/index.html` — the Arabic UI shell;
* `assets/public/assets/device-runtime-*.js` — **the on-device engine** (if this chunk were
  missing, the APK would need a desktop bridge, which is exactly what it must not);
* `assets/capacitor.config.json` — the Capacitor bridge configuration;
* `aapt2 dump badging` output: package id, version, target SDK and the exact permission list;
* the APK's `sha256` and size.

You can reproduce the same checks locally on any downloaded APK:

```bash
unzip -l universal-router-manager-1.0.0.apk | grep -E "device-runtime|index.html|capacitor.config"
aapt2 dump badging universal-router-manager-1.0.0.apk | head -20
sha256sum universal-router-manager-1.0.0.apk
```

## 8. Safety and privacy on Android

* Only use the app on networks you own or are authorised to administer.
* No brute force, no credential attacks, no login bypass, no exploitation — ever.
* Credentials are sealed by the Android Keystore (AES-256-GCM, key never leaves the Keystore).
  Untick *تذكّر هذا الراوتر* and nothing is stored at all.
* No private-network data leaves the device. The only outbound traffic the app can make is the
  internet speed measurement, and only after you enable it yourself.
* Every write is verified by read-back; the app never claims a change it did not observe.
