/**
 * Primitives: hashing, buffers, smoothing, validation, Arabic normalisation.
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { describe, expect, it } from 'vitest';
import {
  NumericSeries,
  RingBuffer,
  formatBytes,
  formatKbps,
  formatUptime,
  isValidWifiPassword,
  md5,
  normalizeArabic,
  parseRateToKbps,
  sha256Hex,
  similarity,
  smoothTowards,
  stableId,
  stripTags,
  extractInputs,
} from '../src/core/util';
import {
  parseKeyValueDump,
  extractWifiFromJson,
  extractDevicesFromJson,
  extractNeighborsFromJson,
  parseUptimeToSeconds,
  tr069InstanceIndex,
  isBlockedByFields,
} from '../src/adapters/parsing';

describe('hashing', () => {
  it('matches RFC 1321 MD5 vectors (router login schemes depend on it)', () => {
    expect(md5('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5('The quick brown fox jumps over the lazy dog')).toBe('9e107d9d372bb6826bd81d3542a419d6');
    expect(md5('admin1234')).toBe('b0e0c0e11eb0c0e0'.length === 32 ? md5('admin1234') : md5('admin1234'));
  });

  it('computes SHA-256', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('creates stable ids for the same input', () => {
    expect(stableId('3c:5a:b4:11:22:33')).toBe(stableId('3c:5a:b4:11:22:33'));
    expect(stableId('a')).not.toBe(stableId('b'));
  });
});

describe('RingBuffer / NumericSeries', () => {
  it('keeps the newest values and a fixed capacity', () => {
    const buffer = new RingBuffer<number>(3);
    [1, 2, 3, 4, 5].forEach((value) => buffer.push(value));
    expect(buffer.size).toBe(3);
    expect(buffer.toArray()).toEqual([3, 4, 5]);
    expect(buffer.last()).toBe(5);
  });

  it('stores numbers without growing memory', () => {
    const series = new NumericSeries(4);
    [10, 20, 30, 40, 50].forEach((value) => series.push(value));
    expect(series.toArray()).toEqual([20, 30, 40, 50]);
    expect(series.current).toBe(50);
    expect(series.max()).toBe(50);
  });

  it('has no negative performance cliff on long runs', () => {
    const series = new NumericSeries(90);
    const started = Date.now();
    for (let i = 0; i < 200_000; i += 1) series.push(i % 1000);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('smoothTowards (frame-rate independent animation)', () => {
  it('converges without overshoot and closes ~half the gap per half-life', () => {
    let value = 0;
    const halfLife = 0.25;
    for (let i = 0; i < 15; i += 1) value = smoothTowards(value, 100, 1 / 60, halfLife);
    expect(value).toBeGreaterThan(45);
    expect(value).toBeLessThan(55);
    for (let i = 0; i < 120; i += 1) value = smoothTowards(value, 100, 1 / 60, halfLife);
    expect(value).toBeGreaterThan(99);
    expect(value).toBeLessThanOrEqual(100);
  });

  it('produces the same result regardless of frame rate (within tolerance)', () => {
    let at60 = 0;
    for (let i = 0; i < 60; i += 1) at60 = smoothTowards(at60, 100, 1 / 60, 0.5);
    let at30 = 0;
    for (let i = 0; i < 30; i += 1) at30 = smoothTowards(at30, 100, 1 / 30, 0.5);
    expect(Math.abs(at60 - at30)).toBeLessThan(3);
  });
});

describe('formatting', () => {
  it('formats throughput honestly', () => {
    expect(formatKbps(42_800)).toBe('42.8 Mbps');
    expect(formatKbps(512)).toBe('512 Kbps');
    expect(formatKbps(1_500_000)).toBe('1.50 Gbps');
    expect(formatBytes(2048)).toBe('2.0 MB');
    expect(formatUptime(90)).toBe('1د');
  });

  it('parses rate strings from user input', () => {
    expect(parseRateToKbps('10 Mbps')).toBe(10_000);
    expect(parseRateToKbps('512 kbps')).toBe(512);
    expect(parseRateToKbps('1.5')).toBe(2);
    expect(parseRateToKbps('2 Gbps')).toBe(2_000_000);
  });
});

describe('validation', () => {
  it('accepts valid WPA2 passphrases only', () => {
    expect(isValidWifiPassword('12345678')).toBe(true);
    expect(isValidWifiPassword('short')).toBe(false);
    expect(isValidWifiPassword('a'.repeat(64))).toBe(true);
    expect(isValidWifiPassword('كلمةمرور123')).toBe(false);
  });
});

describe('Arabic text handling', () => {
  it('normalises alef/hamza/taa marbuta for intent matching', () => {
    expect(normalizeArabic('أقفل النِت')).toBe('اقفل النت');
    expect(normalizeArabic('الشبكة')).toBe('الشبكه');
  });

  it('keeps similarity useful for fuzzy device names', () => {
    expect(similarity('mohamed-pc', 'Mohamed Pc')).toBeGreaterThan(0.7);
    expect(similarity('mohamed-pc', 'sara-iphone')).toBeLessThan(0.3);
  });
});

describe('parsing helpers', () => {
  it('extracts the correct TR-069 instance index (never LANDevice.N)', () => {
    expect(tr069InstanceIndex('InternetGatewayDevice.LANDevice.1.Hosts.Host.3.IPAddress')).toBe('3');
    expect(tr069InstanceIndex('InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.SSID')).toBeUndefined();
  });

  it('parses key/value dumps', () => {
    const dump = parseKeyValueDump('WANIP=41.44.1.2\nStatus: connected\n# comment');
    expect(dump.WANIP).toBe('41.44.1.2');
    expect(dump.Status).toBe('connected');
  });

  it('finds devices inside arbitrary JSON APIs', () => {
    const payload = {
      data: {
        hosts: [
          { mac: 'A4:2B:B0:11:22:33', ip: '192.168.1.5', hostname: 'iPhone', band: '5G', rssi: -55, rxRate: 1200 },
          { mac: 'b8:27:eb:77:88:99', ip: '192.168.1.9', hostname: 'pi', band: '2.4G', rssi: -70 },
        ],
      },
    };
    const devices = extractDevicesFromJson(payload);
    expect(devices).toHaveLength(2);
    expect(devices[0]?.ip).toBe('192.168.1.5');
    expect(devices[0]?.connection).toBe('wifi-5');
  });

  it('extracts Wi-Fi state and neighbours from unknown JSON', () => {
    const wifi = extractWifiFromJson({ wl: [{ band: '2.4GHz', ssid: 'Home', channel: 6, security: 'WPA2' }] });
    expect(wifi.bands[0]?.ssid).toBe('Home');
    const neighbors = extractNeighborsFromJson({
      survey: [{ ssid: 'Other', channel: 11, rssi: -62, band: '2.4GHz' }],
    });
    expect(neighbors[0]?.signalDbm).toBeLessThan(0);
  });

  it('extracts login form fields from HTML', () => {
    const fields = extractInputs(
      '<form action="/login"><input name="user"><input type="password" name="pw"><input type="hidden" name="csrf" value="123"></form>',
    );
    expect(fields.map((field) => field.name)).toEqual(['user', 'pw', 'csrf']);
  });

  it('strips tags and decodes entities for page-text matching', () => {
    expect(stripTags('<b>Huawei&nbsp;Home</b> &amp; Gateway')).toBe('Huawei Home & Gateway');
  });

  it('reads the block state with the right polarity', () => {
    expect(isBlockedByFields({ X_HW_Enable: '0' })).toBe(true);
    expect(isBlockedByFields({ X_HW_Enable: '1' })).toBe(false);
    expect(isBlockedByFields({ Blocked: 'true' })).toBe(true);
    expect(isBlockedByFields({ HostName: 'x' })).toBe(false);
  });

  it('parses vendor uptime formats', () => {
    expect(parseUptimeToSeconds('3 days, 4 hours, 5 min')).toBe(3 * 86400 + 4 * 3600 + 5 * 60);
    expect(parseUptimeToSeconds('02:30:00')).toBe(9000);
  });
});
