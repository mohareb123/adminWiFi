/**
 * Detection & fingerprinting tests (spec §3/§4/§5/§7).
 *
 * - never a single signature: every identification must rest on several
 *   independent signal families;
 * - confidence is calibrated, and a low-confidence device *must* fall back to
 *   the generic adapter instead of guessing;
 * - the signature database is data, so it can be updated without a rebuild.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { describe, expect, it } from 'vitest';
import { createHarness } from './fixtures';
import { SIMULATED_PROFILES, DEMO_PROFILE_IDS } from '../src/simulated/profiles';
import { qualityFromScore } from '../src/fingerprinting/engine';
import type { HttpTransport, HttpResponse } from '../src/core/http';

const fastDiscovery = { scanCommonGateways: false, scanAdminPorts: false } as const;

describe('RouterFingerprintEngine', () => {
  it('identifies every simulated vendor family from multiple independent signals', async () => {
    for (const profileId of DEMO_PROFILE_IDS) {
      const expected = SIMULATED_PROFILES[profileId]!;
      const { engine } = createHarness(profileId);
      const discovery = await engine.discover({ ...fastDiscovery });
      expect(discovery.empty, `${profileId} discovery`).toBe(false);

      const report = await engine.fingerprint(discovery.best!.baseUrl);
      const top = report.candidates[0];

      expect(top, `${profileId} had no candidate`).toBeDefined();
      expect(top!.vendor.toLowerCase()).toContain(expected.state().vendor.toLowerCase());
      expect(top!.confidence, `${profileId} confidence`).toBeGreaterThan(35);

      const families = new Set(report.evidence.filter((entry) => entry.polarity === 'positive').map((entry) => entry.signal));
      expect(families.size, `${profileId} used ${[...families].join(',')}`).toBeGreaterThan(1);
      expect(report.useGenericAdapter, `${profileId} should not need the generic adapter`).toBe(false);
    }
  }, 120_000);

  it('records the evidence chain so Advanced Mode can explain the verdict', async () => {
    const { engine } = createHarness('huawei-hg8145');
    const discovery = await engine.discover({ ...fastDiscovery });
    const report = await engine.fingerprint(discovery.best!.baseUrl);

    expect(report.identity.vendor).toBe('Huawei');
    expect(report.identity.model.length).toBeGreaterThan(0);
    expect(report.capturedAt).toBeTruthy();
    const signals = report.signals;
    expect(signals.gatewayIp).toBe('192.168.1.1');
    expect(signals.title ?? '').toMatch(/huawei/i);
    expect(signals.assetPaths.length).toBeGreaterThan(0);
    expect(signals.formFields.length).toBeGreaterThan(0);
    expect(report.evidence.every((entry) => entry.observed.length < 200)).toBe(true);
  }, 60_000);

  it('falls back to the generic adapter when the device answers nothing recognisable', async () => {
    // A device whose management page carries no signature at all. The engine
    // must stay honest: low confidence + generic adapter, never a guess.
    const blankTransport: HttpTransport = {
      capabilities: {
        kind: 'browser',
        canReadRoutingTable: false,
        canReachLan: false,
        canReadArp: false,
        canProbeLatency: false,
        canMeasureInternetSpeed: false,
        canSnmp: false,
        label: 'blank test transport',
      },
      async request(): Promise<HttpResponse> {
        return {
          url: 'http://192.168.5.1/',
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'text/html' },
          body: '<html><head><title>Router</title></head><body><form><input name="pwd"></form></body></html>',
          durationMs: 4,
          redirected: false,
        };
      },
    };

    const { engine } = createHarness('huawei-hg8145');
    // Swap the transport behind the engine (test-only access).
    (engine as unknown as { transport: HttpTransport }).transport = blankTransport;

    const report = await engine.fingerprint('http://192.168.5.1');
    // Every path answered 200 with the same shell page — soft 404s must not be
    // mistaken for API evidence, so confidence has to stay low.
    expect(report.confidence).toBeLessThan(35);
    expect(report.useGenericAdapter).toBe(true);
    expect(report.recommendedAdapterId).toBe('GenericRouterAdapter');
    expect(report.advisories.join(' ')).toMatch(/limited confidence/i);
  }, 30_000);

  it('maps raw scores onto honest quality labels', () => {
    expect(qualityFromScore(0.97)).toBe('exact');
    expect(qualityFromScore(0.8)).toBe('high');
    expect(qualityFromScore(0.6)).toBe('medium');
    expect(qualityFromScore(0.3)).toBe('low');
    expect(qualityFromScore(0.1)).toBe('unknown');
    expect(qualityFromScore(0)).toBe('unknown');
  });

  it('accepts update packs without rebuilding the application', async () => {
    const { signatures } = createHarness('huawei-hg8145');
    const before = signatures.all().length;
    const result = signatures.loadPack({
      meta: { version: 'sample-pack-1', author: 'Sample Vendor', updatedAt: new Date().toISOString() },
      signatures: [
        {
          id: 'sample-vendor-x1',
          vendor: 'SampleVendor',
          model: 'X1',
          adapter: 'GenericRouterAdapter',
          managementUrl: '/',
          loginPath: '/login',
          authMethod: 'form-post',
          loginType: 'form',
          capabilities: {},
          api: {},
          match: { titles: [{ pattern: 'SampleVendor X1', weight: 0.6 }] },
          operations: [
            {
              id: 'device.block',
              path: '/cgi/block',
              method: 'POST',
              encoding: 'form',
              fieldMap: { mac: 'mac', blocked: 'enable' },
            },
          ],
        },
      ] as never,
    });
    expect(result.added + result.updated).toBeGreaterThan(0);
    expect(result.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(signatures.all().length).toBe(before + 1);
    expect(signatures.get('sample-vendor-x1')?.vendor).toBe('SampleVendor');

    const exported = signatures.exportPack();
    expect(exported.signatures.some((entry) => entry.id === 'sample-vendor-x1')).toBe(true);
  });
});
