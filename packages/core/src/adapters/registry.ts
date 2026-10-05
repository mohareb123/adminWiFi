/**
 * Adapter registry (spec §6).
 *
 * Resolution order:
 *   1. the adapter declared by the winning signature,
 *   2. a vendor adapter matched on the fingerprint identity,
 *   3. GenericRouterAdapter.
 *
 * Nothing here is a hard dependency: an unknown adapter id degrades to Generic
 * instead of failing the whole session.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { createLogger } from '../core/logger';
import type { FingerprintReport } from '../core/types';
import { GenericRouterAdapter } from './generic';
import { HuaweiAdapter, TPLinkAdapter, ZTEAdapter, DLinkAdapter } from './vendors';
import type { RouterAdapter } from './types';

const log = createLogger('adapters');

export type AdapterFactory = () => RouterAdapter;

export class AdapterRegistry {
  private factories = new Map<string, AdapterFactory>();

  register(id: string, factory: AdapterFactory): this {
    this.factories.set(id, factory);
    return this;
  }

  has(id: string): boolean {
    return this.factories.has(id);
  }

  ids(): string[] {
    return [...this.factories.keys()];
  }

  create(id: string): RouterAdapter | undefined {
    const factory = this.factories.get(id);
    return factory ? factory() : undefined;
  }

  /** Pick the best adapter for a fingerprint, always returning something usable. */
  resolve(fingerprint: FingerprintReport): { adapter: RouterAdapter; fallbackUsed: boolean; reason: string } {
    const preferred = fingerprint.recommendedAdapterId;
    if (!fingerprint.useGenericAdapter) {
      const adapter = this.create(preferred);
      if (adapter) return { adapter, fallbackUsed: false, reason: `signature → ${preferred}` };
      log.warn('adapter id not registered, degrading to generic', { preferred });
    } else {
      log.info('low-confidence fingerprint, using the generic adapter', { confidence: fingerprint.confidence });
    }

    // Vendor name fallback (identity may be stronger than the signature pick).
    const vendor = fingerprint.identity.vendor?.toLowerCase() ?? '';
    if (!fingerprint.useGenericAdapter) {
      for (const [id, factory] of this.factories) {
        if (id.toLowerCase().startsWith(vendor) && vendor.length > 2) {
          return { adapter: factory(), fallbackUsed: false, reason: `vendor → ${id}` };
        }
      }
    }

    const generic = this.create('GenericRouterAdapter') ?? new GenericRouterAdapter();
    return { adapter: generic, fallbackUsed: true, reason: 'generic fallback' };
  }
}

/** Registry with the built-in vendor adapters. */
export function createDefaultRegistry(): AdapterRegistry {
  return new AdapterRegistry()
    .register('GenericRouterAdapter', () => new GenericRouterAdapter())
    .register('HuaweiAdapter', () => new HuaweiAdapter())
    .register('TPLinkAdapter', () => new TPLinkAdapter())
    .register('ZTEAdapter', () => new ZTEAdapter())
    .register('DLinkAdapter', () => new DLinkAdapter());
}

/** Everything the About screen lists as "supported adapters". */
export const KNOWN_ADAPTERS = [
  { id: 'GenericRouterAdapter', vendor: 'Any', description: 'Heuristic adapter for unrecognised devices' },
  { id: 'HuaweiAdapter', vendor: 'Huawei', description: 'ONT / Home Gateway / HiLink' },
  { id: 'TPLinkAdapter', vendor: 'TP-Link', description: 'Archer web UI 4/5/6 and legacy UI' },
  { id: 'ZTEAdapter', vendor: 'ZTE', description: 'ZXHN / F-series ONT' },
  { id: 'DLinkAdapter', vendor: 'D-Link', description: 'DIR / DSL webproc' },
];
