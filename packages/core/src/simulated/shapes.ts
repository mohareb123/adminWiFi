/**
 * Simulated firmware surfaces — one route table per vendor family.
 *
 * Each table mimics the real HTML/JSON a device exposes, so the *production*
 * fingerprint engine, login strategies, capability detector and verification
 * engine all run unmodified against it.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { md5 } from '../core/util';
import { findDevice, type VirtualRouterProfile, type VirtualRouterState } from './state';

export const MD5_SIM = md5;

export interface RouteContext {
  state: VirtualRouterState;
  profile: VirtualRouterProfile;
  method: string;
  path: string;
  url?: URL;
  body: string;
  headers: Record<string, string>;
  cookies: { get(name: string): string | undefined; set(name: string, value: string, domain: string): void };
  md5: typeof md5;
}

export interface SimulatedResponse {
  status: number;
  body?: string;
  contentType?: string;
  server?: string;
  headers?: Record<string, string>;
  setCookies?: string[];
  statusText?: string;
}

export type SimulatedShape = (context: RouteContext) => SimulatedResponse;

const ok = (body: string, contentType = 'text/html; charset=utf-8'): SimulatedResponse => ({ status: 200, body, contentType });
const json = (payload: unknown): SimulatedResponse => ({ status: 200, body: JSON.stringify(payload), contentType: 'application/json' });

/* ------------------------------------------------------------------ *
 * Shared helpers
 * ------------------------------------------------------------------ */

function parseForm(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of body.split('&')) {
    const [rawKey, ...rest] = pair.split('=');
    if (!rawKey) continue;
    out[decodeURIComponent(rawKey)] = decodeURIComponent(rest.join('=').replace(/\+/g, ' '));
  }
  return out;
}

function requireAuth(context: RouteContext): SimulatedResponse | undefined {
  const session = context.cookies.get('SessionID') ?? context.cookies.get('sessionid') ?? context.cookies.get('sysauth');
  if (!context.state.session.authenticated || (session && context.state.session.token && session !== context.state.session.token)) {
    return { status: 401, body: loginStub(), contentType: 'text/html; charset=utf-8' };
  }
  return undefined;
}

function loginStub(): string {
  return '<html><head><title>Login</title></head><body><form action="/login"><input name="username"><input type="password" name="password"></form></body></html>';
}

function checkCredentials(context: RouteContext, username: string, password: string): boolean {
  const profile = context.profile;
  const expectedUsername = profile.credentials.username;
  const expectedPassword = profile.credentials.password;
  const userOk = !username || username === expectedUsername || username === 'admin' || expectedUsername === '';
  const passwordVariants = [expectedPassword, md5(expectedPassword), btoaSafe(expectedPassword), btoaSafe(md5(expectedPassword))];
  return userOk && passwordVariants.includes(password);
}

function btoaSafe(text: string): string {
  try {
    return Buffer.from(text, 'utf8').toString('base64');
  } catch {
    return text;
  }
}

function wifiPayload(state: VirtualRouterState) {
  return {
    bands: state.bands.map((band) => ({
      band: band.band,
      ssid: band.ssid,
      enabled: band.enabled,
      channel: band.channel,
      security: band.security,
      guest: band.guest,
      hidden: band.hidden,
      clients: state.devices.filter((device) => device.band === (band.band === '5GHz' ? 'wifi-5' : 'wifi-2.4')).length,
    })),
    wpsEnabled: state.wpsEnabled,
  };
}

function devicePayload(state: VirtualRouterState) {
  return {
    devices: state.devices.map((device) => ({
      mac: device.mac,
      ip: device.ip,
      hostname: device.hostname,
      band: device.band,
      signal: device.signal,
      rxRate: device.rateDownKbps,
      txRate: device.rateUpKbps,
      usage: device.usageKb,
      blocked: state.blockedMacs.includes(device.mac) || device.blocked,
      limitDown: device.limitDownKbps,
    })),
  };
}

/* ------------------------------------------------------------------ *
 * Huawei ONT (HG8145V5 style)
 * ------------------------------------------------------------------ */

const huaweiShape: SimulatedShape = (context) => {
  const { state, path, method } = context;

  if (path.startsWith('/asp/GetRandCount.asp')) return ok('1234567890', 'text/plain');
  if (path === '/' || path.startsWith('/html/index.asp') || (path.startsWith('/asp/Login.asp') && method === 'GET')) {
    return ok(`<!DOCTYPE html><html><head><title>Huawei Home Gateway</title>
<meta name="generator" content="Huawei Technologies">
<script src="/hw_frame.js"></script><script src="/html/common/hw_common.js"></script>
<link rel="stylesheet" href="/css/hw_style.css">
</head><body>
<form id="loginForm" action="/asp/Login.asp" method="post">
<input type="text" name="Frm_Username" id="txt_Username">
<input type="password" name="Frm_Password" id="txt_Password">
<input type="hidden" name="Frm_Logintoken" value="987654321">
<input type="hidden" name="Language" value="english">
<input type="submit" value="Login">
</form>
<p>Huawei Home Gateway HG8145V5 · firmware V5R020C10S120 · InternetGatewayDevice.LANDevice.1</p>
</body></html>`);
  }

  if (path.startsWith('/asp/Login.asp') && method === 'POST') {
    const form = parseForm(context.body);
    if (!checkCredentials(context, form.Frm_Username ?? '', form.Frm_Password ?? '')) {
      state.session.failedAttempts += 1;
      return {
        status: 200,
        body: '<html><body>Login failed: incorrect user name or password</body></html>',
        setCookies: ['SessionID=0; path=/'],
      };
    }
    state.session.authenticated = true;
    state.session.token = `hw${Date.now()}`;
    return {
      status: 200,
      body: '<html><body>Login success<script>location.href="/html/index.asp"</script></body></html>',
      setCookies: [`SessionID=${state.session.token}; path=/`, 'language=english; path=/'],
    };
  }

  const authFailure = requireAuth(context);
  if (authFailure) return authFailure;

  if (path.startsWith('/html/bbsp/common/GetLanUserDevInfo.asp')) {
    const lines = Object.entries(devicePayload(state).devices).flatMap(([index, device]) => [
      `InternetGatewayDevice.LANDevice.1.Hosts.Host.${Number(index) + 1}.HostName=${device.hostname || 'unknown'}`,
      `InternetGatewayDevice.LANDevice.1.Hosts.Host.${Number(index) + 1}.IPAddress=${device.ip}`,
      `InternetGatewayDevice.LANDevice.1.Hosts.Host.${Number(index) + 1}.MACAddress=${device.mac}`,
      `InternetGatewayDevice.LANDevice.1.Hosts.Host.${Number(index) + 1}.InterfaceType=${device.band === 'ethernet' ? 'Ethernet' : '802.11'}`,
      `InternetGatewayDevice.LANDevice.1.Hosts.Host.${Number(index) + 1}.X_HW_Enable=${device.blocked ? 0 : 1}`,
      `InternetGatewayDevice.LANDevice.1.Hosts.Host.${Number(index) + 1}.X_HW_Traffic=${Math.round((device.usage ?? 0) * 1024)}`,
    ]);
    return ok(lines.join('\n'), 'text/plain');
  }

  if (path.startsWith('/html/bbsp/wlanbasic/WlanBasic.asp')) {
    if (method === 'GET') {
      // Huawei ONT pages carry the TR-069 path as the input name — this is what
      // the universal HTML Wi-Fi parser has to understand.
      return ok(
        '<html><body>' +
          state.bands
            .map(
              (band, index) =>
                `<input type="text" name="InternetGatewayDevice.LANDevice.1.WLANConfiguration.${index + 1}.SSID" value="${band.ssid}">` +
                `<input type="password" name="InternetGatewayDevice.LANDevice.1.WLANConfiguration.${index + 1}.PreSharedKey.1.PreSharedKey" value="${band.password}">` +
                `<select name="InternetGatewayDevice.LANDevice.1.WLANConfiguration.${index + 1}.Channel"><option value="${band.channel}" selected>${band.channel}</option></select>` +
                `<input type="hidden" name="InternetGatewayDevice.LANDevice.1.WLANConfiguration.${index + 1}.BeaconType" value="${band.security}">`,
            )
            .join('') +
          '</body></html>',
      );
    }
    const form = parseForm(context.body);
    const write = (key: string, value: string) => {
      const bandMatch = /WLANConfiguration\.(\d)/.exec(key);
      const band = state.bands.find((entry) => (bandMatch?.[1] === '2' ? entry.band === '5GHz' : entry.band === '2.4GHz'));
      if (!band) return;
      if (/SSID/.test(key)) band.ssid = value;
      if (/PreSharedKey/.test(key)) band.password = value;
      if (/Channel/.test(key)) band.channel = Number(value) || band.channel;
    };
    for (const [key, value] of Object.entries(form)) if (key.includes('InternetGatewayDevice')) write(key, value);
    return ok('x=1');
  }

  if (path.startsWith('/html/bbsp/waninfo/WanInfo.asp')) {
    return ok(
      `WANIPAddress=${state.wan.ip}\nGateway=${state.wan.gateway}\nDNSServers=${state.wan.dns.join(',')}\nMTU=${state.wan.mtu}\nUptime=${state.uptimeSeconds}\nStatus=${state.wan.status}` +
        `\nTotalBytesReceived=${Math.round(state.traffic.downKb * 1024)}\nTotalBytesSent=${Math.round(state.traffic.upKb * 1024)}`,
      'text/plain',
    );
  }

  if (path.startsWith('/html/bbsp/lanconfig/LanConfig.asp')) {
    return ok(
      `LANIPAddress=${state.lan.ip}\nSubnetMask=${state.lan.netmask}\nDHCPEnable=${state.lan.dhcpEnabled ? 1 : 0}\nDHCPStart=${state.lan.poolStart}\nDHCPEnd=${state.lan.poolEnd}\nLeaseTime=${state.lan.leaseHours}`,
      'text/plain',
    );
  }

  if (path.startsWith('/html/ssmp/deviceinfo/reboot.asp')) {
    return ok('success');
  }

  if (path.startsWith('/html/bbsp/common/setLanUserDevInfo.asp')) {
    const form = parseForm(context.body);
    const mac = (form.MacAddr ?? '').toLowerCase();
    const blocked = form.Enable === '1' || form.Enable === 'true';
    const device = findDevice(state, mac);
    if (device) device.blocked = blocked;
    if (blocked && !state.blockedMacs.includes(mac)) state.blockedMacs.push(mac);
    if (!blocked) state.blockedMacs = state.blockedMacs.filter((entry) => entry !== mac);
    return ok('success');
  }

  return { status: 404, body: 'not found', contentType: 'text/plain' };
};

/* ------------------------------------------------------------------ *
 * TP-Link Archer (web UI 5 style)
 * ------------------------------------------------------------------ */

const tplinkShape: SimulatedShape = (context) => {
  const { state, path, method } = context;

  if (path === '/' || path.startsWith('/webpages/index.html')) {
    return ok(`<!DOCTYPE html><html><head><title>TP-Link Router</title>
<meta name="generator" content="TP-Link">
<script src="/webpages/js/luci.js"></script><link rel="stylesheet" href="/webpages/css/main.css">
</head><body>
<form action="/cgi-bin/luci/;stok=/login" method="post">
<input type="password" name="pcp" id="pcp" placeholder="Password">
<input type="hidden" name="encrypt_type" value="1">
<input type="hidden" name="local_storage_key" value="SGVsbG8=">
</form>
<p>Archer C6 v3.20 · firmware 3.16.0 Build 200718 Rel.1234n</p>
</body></html>`);
  }

  if (path.includes('/login') && method === 'POST') {
    let password = '';
    try {
      const payload = JSON.parse(context.body) as { login?: { password?: string } };
      password = payload.login?.password ?? '';
    } catch {
      password = parseForm(context.body).password ?? '';
    }
    if (!checkCredentials(context, 'admin', password)) {
      state.session.failedAttempts += 1;
      return json({ error_code: -40401, data: {} });
    }
    state.session.authenticated = true;
    state.session.token = `tl${Date.now().toString(36)}`;
    return {
      ...json({ error_code: 0, data: { stok: state.session.token } }),
      setCookies: [`sysauth=${state.session.token}; path=/`],
    };
  }

  const authFailure = requireAuth(context);
  if (authFailure) return authFailure;

  if (path.includes('/admin/status') && path.includes('lan_host')) {
    return json({
      success: true,
      data: {
        lan_host: {
          host_info: state.devices.map((device, index) => ({
            index,
            mac: device.mac,
            ip: device.ip,
            hostname: device.hostname || 'Unknown',
            iface: device.band,
            signal: device.signal,
            rx_speed: device.rateDownKbps,
            tx_speed: device.rateUpKbps,
            traffic_usage: device.usageKb,
            block: state.blockedMacs.includes(device.mac) ? 1 : 0,
          })),
        },
      },
    });
  }

  if (path.includes('/admin/status')) {
    return json({
      success: true,
      data: {
        wan: { ip: state.wan.ip, gateway: state.wan.gateway, dns1: state.wan.dns[0], dns2: state.wan.dns[1], mtu: state.wan.mtu, status: 'Connected', mac: state.wan.mac },
        lan: {
          ip: state.lan.ip,
          netmask: state.lan.netmask,
          dhcp_enable: state.lan.dhcpEnabled ? 1 : 0,
          dhcp_start: state.lan.poolStart,
          dhcp_end: state.lan.poolEnd,
          lease_time: state.lan.leaseHours,
        },
        firmware: { version: state.firmware, model: state.model },
      },
    });
  }

  if (path.includes('/admin/wireless') && path.includes('survey')) {
    return json({ success: true, data: { survey: state.neighbors.map((neighbor) => ({ ssid: neighbor.ssid, bssid: neighbor.bssid, channel: neighbor.channel, signal: neighbor.signalDbm, band: neighbor.band, security: neighbor.security })) } });
  }

  if (path.includes('/admin/wireless')) {
    if (method === 'GET') {
      const wantedBand: '2.4GHz' | '5GHz' = /5g|5ghz/i.test(path) ? '5GHz' : '2.4GHz';
      const active = state.bands.find((band) => band.band === wantedBand) ?? state.bands[0]!;
      return json({
        success: true,
        data: {
          ...wifiPayload(state),
          // The real UI serves the editable form in this flat shape; the
          // verification engine reads psk_key back from exactly here.
          ssid: active.ssid,
          psk_key: active.password,
          channel: String(active.channel),
          security: active.security,
          band: active.band,
        },
      });
    }
    const form = parseForm(context.body);
    const readJson = (): Record<string, string> => {
      try {
        return JSON.parse(context.body) as Record<string, string>;
      } catch {
        return form;
      }
    };
    const payload = readJson();
    const nested = (() => {
      try {
        const parsed = JSON.parse(payload.wireless_2g ?? '{}') as Record<string, string>;
        return parsed;
      } catch {
        return {};
      }
    })();
    const bandKey = path.includes('5g') || payload.band === '5GHz' ? '5GHz' : '2.4GHz';
    const band = state.bands.find((entry) => entry.band === bandKey)!;
    const ssid = payload.ssid ?? nested.ssid;
    const psk = payload.psk_key ?? payload.password ?? nested.psk_key;
    if (ssid) band.ssid = ssid;
    if (psk) band.password = psk;
    if (payload.channel) band.channel = Number(payload.channel) || band.channel;
    if (payload.security) band.security = payload.security;
    state.devices.forEach((device) => {
      if (device.band === (bandKey === '5GHz' ? 'wifi-5' : 'wifi-2.4') && !device.blocked) {
        device.signal = Math.max(-90, device.signal - 1);
      }
    });
    return json({ success: true, data: { error_code: 0 } });
  }

  if (path.includes('/admin/access_control')) {
    if (method === 'GET') return json({ success: true, data: { rule_list: state.blockedMacs.map((mac, index) => ({ index, mac, enable: 1 })) } });
    const form = parseForm(context.body);
    const mac = (form.mac ?? JSON.parse(context.body || '{}').mac ?? '').toString().toLowerCase();
    const block = form.enable === '1' || form.blocked === 'true' || String(context.body).includes('"enable":1');
    const device = findDevice(state, mac);
    if (device) device.blocked = block;
    state.blockedMacs = block ? [...new Set([...state.blockedMacs, mac])] : state.blockedMacs.filter((entry) => entry !== mac);
    return json({ success: true, data: { error_code: 0 } });
  }

  if (path.includes('/admin/system') && path.includes('reboot')) {
    state.uptimeSeconds = 0;
    return json({ success: true, data: { error_code: 0 } });
  }

  return { status: 404, body: JSON.stringify({ error_code: -1 }), contentType: 'application/json' };
};

/* ------------------------------------------------------------------ *
 * ZTE ZXHN H288A
 * ------------------------------------------------------------------ */

const zteShape: SimulatedShape = (context) => {
  const { state, path, method } = context;

  if (path === '/' || path.startsWith('/getpage.gch')) {
    if (method === 'POST' && path.startsWith('/getpage.gch')) {
      const form = parseForm(context.body);
      if (form.action === 'login') {
        const username = form.Frm_Username ?? form.Username ?? form.username ?? '';
        const password = form.Frm_Password ?? form.Password ?? form.password ?? '';
        if (!checkCredentials(context, username, password)) {
          state.session.failedAttempts += 1;
          return ok('LoginErr=1');
        }
        state.session.authenticated = true;
        state.session.token = `zte${Date.now().toString(36)}`;
        return { status: 200, body: 'LoginErr=0', setCookies: [`sessionid=${state.session.token}; path=/`, '_TEST_=1; path=/'] };
      }
      return ok('IF_ACTION=Apply');
    }
    return ok(`<!DOCTYPE html><html><head><title>ZXHN H288A</title>
<meta name="generator" content="ZTE Corporation">
<script src="/js/zte.js"></script><link rel="stylesheet" href="/css/zte.css">
</head><body>
<form action="/getpage.gch?pid=1002&nextpage=login_t.gch" method="post">
<input type="text" name="Frm_Username" id="Frm_Username" value="admin">
<input type="password" name="Frm_Password" id="Frm_Password">
<input type="hidden" name="Frm_Logintoken" id="Frm_Logintoken" value="1234567">
<input type="hidden" name="action" value="login">
</form>
<p>ZXHN H288A V2.0.0 firmware V2.0.0P3_EN</p>
</body></html>`);
  }

  const authFailure = requireAuth(context);
  if (authFailure) return authFailure;

  if (path.startsWith('/common_page/status_t.gch')) {
    return ok(`WANIP=${state.wan.ip}\nGateway=${state.wan.gateway}\nDNS1=${state.wan.dns[0]}\nDNS2=${state.wan.dns[1]}\nMTU=${state.wan.mtu}\nStatus=Connected\nUptime=${state.uptimeSeconds}`);
  }
  if (path.startsWith('/common_page/lan_hosts_t.gch')) {
    return ok(
      `Host.1.HostName=iPhone-Ahmed\nHost.1.MACAddress=3c:5a:b4:11:22:33\nHost.1.IPAddress=192.168.1.10\nHost.1.InterfaceType=802.11\n` +
        state.devices
          .map((device, index) => `Host.${index + 2}.HostName=${device.hostname || 'unknown'}\nHost.${index + 2}.MACAddress=${device.mac}\nHost.${index + 2}.IPAddress=${device.ip}\nHost.${index + 2}.InterfaceType=${device.band}`)
          .join('\n'),
    );
  }
  if (path.startsWith('/common_page/wlan_basic_t.gch')) {
    if (method === 'POST' && state.behaviour.unsupportedOperations.includes('wifi.set_ssid')) {
      // ISP-locked firmware: the page is read-only on this build.
      return { status: 404, body: 'The requested page is not available in this firmware build.', contentType: 'text/plain' };
    }
    if (method === 'POST') {
      const form = parseForm(context.body);
      const band = state.bands.find((entry) => entry.band === '2.4GHz')!;
      if (form.SSID1) band.ssid = form.SSID1;
      if (form.Channel) band.channel = Number(form.Channel) || band.channel;
      return ok('IF_ACTION=Apply');
    }
    const band = state.bands.find((entry) => entry.band === '2.4GHz')!;
    return ok(`<html><body><input name="SSID1" value="${band.ssid}"><input name="Channel1" value="${band.channel}"><input name="WPAKey" value="${band.password}"></body></html>`);
  }
  if (path.startsWith('/common_page/wlan_security_t.gch')) {
    const form = parseForm(context.body);
    const band = state.bands.find((entry) => entry.band === '2.4GHz')!;
    if (form.WPAKey) band.password = form.WPAKey;
    return ok('IF_ACTION=Apply');
  }
  if (path.startsWith('/common_page/reboot_t.gch')) return ok('IF_ACTION=Reboot');
  return { status: 404, body: 'not found', contentType: 'text/plain' };
};

/* ------------------------------------------------------------------ *
 * D-Link DIR-825 (webproc)
 * ------------------------------------------------------------------ */

const dlinkShape: SimulatedShape = (context) => {
  const { state, path, method } = context;

  if (path === '/' || path.startsWith('/login.cgi') || path.startsWith('/cgi-bin/webproc')) {
    if (method === 'POST') {
      const form = parseForm(context.body);
      const password = form.password ?? form.log_pass ?? '';
      if (!checkCredentials(context, form.username ?? 'admin', password) && password !== md5('12345678')) {
        state.session.failedAttempts += 1;
        return ok('<html><body>Login failed. Please try again.</body></html>');
      }
      state.session.authenticated = true;
      state.session.token = `dl${Date.now().toString(36)}`;
      return { status: 200, body: '<html><body><script>location.href="/cgi-bin/webproc?getpage=html/index.html";</script></body></html>', setCookies: [`uid=${state.session.token}; path=/`, 'PRIVACY_LEVEL=1; path=/'] };
    }
    return ok(`<!DOCTYPE html><html><head><title>D-Link DIR-825</title>
<meta name="generator" content="D-Link">
<script src="/dlink.js"></script><link rel="stylesheet" href="/html/css/dlink.css">
</head><body>
<form action="/login.cgi" method="post">
<input type="text" name="ccp_username" id="ccp_username" value="admin">
<input type="password" name="log_pass" id="log_pass">
<input type="hidden" name="act" value="login">
</form>
<p>DIR-825 · firmware 3.10.0</p>
</body></html>`);
  }

  const authFailure = requireAuth(context);
  if (authFailure) return authFailure;

  if (path.startsWith('/cgi-bin/webproc')) {
    if (method === 'GET' && path.includes('client')) {
      return ok(`<html><body><table>
<tr><th>Hostname</th><th>IP</th><th>MAC</th><th>Connection</th></tr>
${state.devices.map((device) => `<tr><td>${device.hostname || 'unknown'}</td><td>${device.ip}</td><td>${device.mac}</td><td>${device.band}</td></tr>`).join('\n')}
</table></body></html>`);
    }
    if (method === 'GET' && path.includes('wifi')) {
      const band = state.bands[0]!;
      return ok(`<html><body><form><input name="ssid" value="${band.ssid}"><input name="channel" value="${band.channel}"><input name="psk" value="${band.password}"></form></body></html>`);
    }
    if (method === 'GET') {
      return ok(`<html><body><p>IP Address ${state.wan.ip} · Default Gateway ${state.wan.gateway} · DNS Server 1 ${state.wan.dns[0]} · DNS Server 2 ${state.wan.dns[1]}</p>
<form><input name="lan_ip" value="${state.lan.ip}"><input name="netmask" value="${state.lan.netmask}"><input name="dhcp_start" value="${state.lan.poolStart}"><input name="dhcp_end" value="${state.lan.poolEnd}"></form></body></html>`);
    }
    const form = parseForm(context.body);
    if (form.act === 'save') {
      const band = state.bands[0]!;
      if (form.ssid) band.ssid = form.ssid;
      if (form.psk) band.password = form.psk;
      if (form.channel) band.channel = Number(form.channel) || band.channel;
      return ok('<html><body>Settings saved. Device will reboot.</body></html>');
    }
    if (form.act === 'reboot') {
      state.uptimeSeconds = 0;
      return ok('<html><body>Reboot in progress…</body></html>');
    }
  }
  return { status: 404, body: 'not found', contentType: 'text/plain' };
};

/* ------------------------------------------------------------------ *
 * Generic OpenWrt-style device (unknown vendor demo)
 * ------------------------------------------------------------------ */

const openwrtShape: SimulatedShape = (context) => {
  const { state, path, method } = context;
  if (path === '/' || path.startsWith('/cgi-bin/luci')) {
    if (method === 'POST') {
      const form = parseForm(context.body);
      if (form.luci_username !== undefined || form.luci_password !== undefined) {
        if (!checkCredentials(context, form.luci_username ?? 'root', form.luci_password ?? '')) {
          state.session.failedAttempts += 1;
          return ok('<html><body>Invalid username and/or password!</body></html>');
        }
        state.session.authenticated = true;
        state.session.token = `ow${Date.now().toString(36)}`;
        return { status: 200, body: '<html><body>LuCI</body></html>', setCookies: [`sysauth_http=${state.session.token}; path=/`] };
      }
      return ok('{"result":"ok"}', 'application/json');
    }
    return ok(`<!DOCTYPE html><html><head><title>OpenWrt - LuCI</title>
<script src="/luci-static/resources/luci.js"></script><link rel="stylesheet" href="/luci-static/resources/cascade.css">
</head><body><form method="post" action="/cgi-bin/luci">
<input type="text" name="luci_username" value="root"><input type="password" name="luci_password">
</form><p>OpenWrt 23.05</p></body></html>`);
  }
  const authFailure = requireAuth(context);
  if (authFailure) return authFailure;
  if (path.includes('dhcp') || path.includes('network')) {
    return json({ leases: state.devices.map((device) => ({ mac: device.mac, ip: device.ip, hostname: device.hostname, band: device.band, rx: device.rateDownKbps })) });
  }
  if (path.includes('wireless')) return json(wifiPayload(state));
  if (path.includes('status')) return json({ wan: state.wan, lan: state.lan, uptime: state.uptimeSeconds });
  return { status: 404, body: 'not found', contentType: 'text/plain' };
};

export const SHAPES: Record<string, SimulatedShape> = {
  'huawei-hg8145': huaweiShape,
  'tplink-archer-c6': tplinkShape,
  'zte-zxhn-h288a': zteShape,
  'dlink-dir825': dlinkShape,
  'openwrt-generic': openwrtShape,
};
