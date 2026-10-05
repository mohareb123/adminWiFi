# Support matrix, simulators and real hardware

> © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved. · **ABU ELAZ ULTRA MAN**

Universal Router Manager adapts to routers it was never written for. That claim only means
something if we are precise about **what is known, what is inferred, and what is honestly
unknown**. This page is that precision.

## 1. How a router gets supported

1. **Fingerprint** — many signals together (gateway IP/MAC + OUI, HTTP headers, login page
   structure, HTML/CSS/JS signatures, candidate API endpoints, device/firmware description,
   UPnP/TR-064 description, TLS certificate, DHCP hints, SNMP only if the network already
   permits it). One signature is never enough.
2. **Score against the signature database**, which stores vendor, model patterns, firmware
   patterns, login type, management URL, auth method, capabilities, API/UI selectors, adapter
   id and a confidence weight. New packs can be loaded at runtime — no rebuild.
3. **Decide** — high confidence binds a vendor adapter; low confidence shows
   «تم التعرف على الراوتر بثقة محدودة» and uses `GenericRouterAdapter` rather than guessing.
4. **Learn** — the observed fingerprint is recorded locally (never credentials), so the next
   scan converges faster. Learning suggests; it never silently changes router settings.
5. **Probe capabilities** — the capability matrix is built from *observed* behaviour. Anything
   that was not observed as working shows «غير مدعوم على هذا الراوتر» or a disabled action,
   never a green check.

## 2. Shipped adapters and signature packs

| Family | Adapter | Typical models | Login | Verified operations (when observed) |
| --- | --- | --- | --- | --- |
| Huawei | `HuaweiAdapter` | HG8145 / HG8245 / HG8247, HiLink | form POST (+ pre-login probe) | devices list/block/rename, Wi-Fi set, WAN reconnect, reboot, backup |
| ZTE | `ZteAdapter` | F660 / F670 / ZXHN H288A | `Frm_Username` / `Frm_Password` POST | devices list/block, Wi-Fi set, reboot |
| TP-Link | `TpLinkAdapter` | Archer (new UI), legacy CGI | token/session then CGI write | devices, Wi-Fi set, channel, reboot |
| D-Link | `DlinkAdapter` | DIR / DSL families | session login, CGI | Wi-Fi set, reboot, partial device list |
| Everything else | `GenericRouterAdapter` | any | discovered recipe | read-mostly: identity, snapshot, Wi-Fi read, diagnostics |

A firmware revision that changes markup does **not** produce a fake success — it downgrades the
adapter to read-only for the affected operation and says so.

## 3. Simulated routers (demo backend)

The simulators implement the real transport contract, so the demo path in the UI exercises the
production pipeline (fingerprint → auth → snapshot → operation → **verification** → speed test).

| Profile id | Router | Credentials | Devices |
| --- | --- | --- | --- |
| `huawei-hg8145` (default) | Huawei HG8145P5 | `admin` / `Admin@123` | 6 (5 Wi-Fi, 1 Ethernet) |
| `zte-zxhn-h288a` | ZTE ZXHN H288A | `admin` / `Zte@2024` | 6 |
| `tplink-archer-c6` | TP-Link Archer C6 v3 | `admin` / `admin1234` | 6 |
| `dlink-dir825` | D-Link DIR-825 | `admin` / `12345678` | 6 |
| `openwrt-generic` | OpenWrt (x86) | `root` / `openwrt` | 6 |

Each profile renders realistic HTML/JS/JSON login and management shapes (including soft-404
traps) so the fingerprint engine has to earn its confidence the same way it does in the field.
The demo profile can be switched from the Connect screen or Advanced Mode; changing profile
re-runs discovery, fingerprinting and capability detection from scratch.

## 4. Using real hardware

The bridge is the only component that ever touches a physical router, and it runs on the user's
own machine — on the same LAN as the router.

```bash
npm install
npm run dev:bridge -- --real        # binds 127.0.0.1:8787, talks to the local gateway
```

* Discovery reads the local routing table/ARP and probes the gateway conservatively (no brute
  force, no credential attacks, no login bypass — ever).
* Only use it on networks you own or are authorised to administer.
* Real mode requires the router's administration interface to be reachable from the machine
  running the bridge. ISP-locked gateways that only expose a mobile app, or that block the
  admin UI on the LAN, will be reported as unsupported instead of half-working.
* Nothing about the private network leaves the machine: no telemetry, no cloud calls, and
  credentials stay in the encrypted vault.

## 5. Known limits (stated plainly)

* Browser-only deployment cannot reach the LAN — a bridge (or the future Android layer) is
  required for real routers. This is a platform limit, not a missing feature.
* Wi-Fi **scanning** requires the router to expose a survey endpoint; where it does not, the
  analyzer says so and shows nothing rather than inventing neighbouring networks.
* Wi-Fi **channel changes** are only offered when the router documents/accepts them; some ISP
  firmwares refuse every channel but the current one, and we report the refusal.
* SNMP and TR-064 are used strictly opportunistically — if the router does not offer them, the
  engine does not attempt to enable them.
* Some counters (per-device usage, WAN traffic) are only as accurate as the router's own
  accounting; the UI labels derived numbers as estimates where appropriate.
