/**
 * Signature model.
 *
 * A signature is *data*, not code: plain, serialisable JSON so new routers can
 * be added or corrected without rebuilding the application (spec §4/§45).
 * Every field contributes weighted evidence; no single indicator is ever
 * trusted on its own (spec §3).
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import type { CapabilityId, CapabilitySupport, OperationId } from '../core/types';

export interface WeightedPattern {
  /** Regular-expression source, matched case-insensitively. */
  pattern: string;
  /** Contribution to the candidate score in [0,1]. */
  weight: number;
  /** Human readable label used in the evidence list. */
  label?: string;
  /** Capture-group index (1-based) whose text becomes the model/firmware. */
  extractGroup?: number;
  /** What the captured value represents. */
  extractAs?: 'model' | 'firmware' | 'hardware' | 'serial' | 'realm';
}

export interface SignatureMatchSpec {
  titles?: WeightedPattern[];
  /** Header name (lowercase) → matchers against its value. */
  headers?: Record<string, WeightedPattern[]>;
  /** Matchers against the full root/login document. */
  body?: WeightedPattern[];
  /** Matchers against referenced css/js asset paths. */
  assets?: WeightedPattern[];
  /** Matchers against discovered form field names/ids/placeholders (joined). */
  formFields?: WeightedPattern[];
  /** Matchers against cookie names observed on the management host. */
  cookies?: WeightedPattern[];
  /** Matchers against the derived server banner. */
  serverBanner?: WeightedPattern[];
  /** Matchers against WWW-Authenticate realm. */
  authRealm?: WeightedPattern[];
  /** Matchers against declared/used API endpoint paths. */
  apiPaths?: WeightedPattern[];
  /** Matchers against <meta name="generator">. */
  metaGenerator?: WeightedPattern[];
  /** MAC OUI prefixes (no separator, lowercase) — strong vendor evidence. */
  oui?: string[];
  /** Evidence that *disproves* this signature (e.g. a competing brand token). */
  negative?: WeightedPattern[];
}

export interface SignatureOperation {
  id: OperationId;
  /** Path template, `{placeholder}` segments are substituted by the adapter. */
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Body encoding expected by the device. */
  encoding?: 'form' | 'json' | 'query' | 'none';
  /** Static body fields merged with dynamic params. */
  staticBody?: Record<string, string>;
  /** Field names the adapter must map operation params onto. */
  fieldMap?: Record<string, string>;
  /** Response assertion proving the operation was accepted. */
  expect?: { body?: string; status?: number; notBody?: string };
  /** Path used to read the value back for verification. */
  readBack?: string;
  /** Extract a value from the read-back response. */
  readBackPattern?: string;
  notes?: string;
}

export interface SignatureApiMap {
  deviceInfo?: string;
  deviceList?: string;
  deviceBlock?: string;
  deviceRename?: string;
  deviceLimits?: string;
  wifiInfo?: string;
  wifiSet?: string;
  wifiScan?: string;
  guestNetwork?: string;
  wanInfo?: string;
  lanInfo?: string;
  dhcpInfo?: string;
  dnsInfo?: string;
  qos?: string;
  firewall?: string;
  portForwarding?: string;
  reboot?: string;
  backup?: string;
  restore?: string;
  stats?: string;
  logs?: string;
  firmware?: string;
}

export interface RouterSignature {
  id: string;
  vendor: string;
  /** Human model label. Use "family" wording when the signature is generic. */
  model: string;
  /** Model regexes used to refine the model name from observed strings. */
  modelPatterns?: string[];
  aliases?: string[];
  firmwarePatterns?: WeightedPattern[];
  /** Default management endpoints in probe order. */
  managementUrls?: string[];
  loginType:
    | 'form-session'
    | 'form-session-token'
    | 'http-basic'
    | 'http-digest'
    | 'token-bearer'
    | 'vendor-custom';
  /** Path of the login page relative to the management base URL. */
  loginPath?: string;
  authMethod: string;
  /** Capability hints; anything not listed is probed dynamically. */
  capabilities?: Partial<Record<CapabilityId, CapabilitySupport>>;
  api?: SignatureApiMap;
  operations?: SignatureOperation[];
  adapter: string;
  match: SignatureMatchSpec;
  /** Cap on the score this signature can contribute alone (anti-overreach). */
  maxConfidence?: number;
  /** Score below which this signature should not be selected. */
  minConfidence?: number;
  /** Selector hints for the HTML fallback engine (GenericRouterAdapter). */
  uiSelectors?: Record<string, string>;
  notes?: string;
  /** Provenance of the entry: built-in or community/update-pack. */
  source?: 'builtin' | 'update-pack' | 'learned';
  /** Rough per-operation support level used by the capability detector. */
  known?: {
    /** Operations known to be unreliable on this family (blocked in UI). */
    blockedOperations?: OperationId[];
    /** Extra advisory shown in Advanced Mode. */
    advisories?: string[];
  };
}

export interface SignatureDatabaseMeta {
  version: string;
  updatedAt: string;
  count: number;
  /** Vendors covered — surfaced in About/Advanced Mode. */
  vendors: string[];
}

/** A router family recorded by the self-learning compatibility layer (§45). */
export interface LearnedProfile {
  id: string;
  createdAt: string;
  updatedAt: string;
  vendor: string;
  model: string;
  firmware?: string;
  /** Fingerprint signal digest (no credentials, no session data). */
  signalDigest: {
    title?: string;
    serverBanner?: string;
    cookieNames: string[];
    assetHashes: string[];
    apiPaths: string[];
    oui?: string;
  };
  adapterUsed: string;
  /** Operation outcome counters used to refine future capability decisions. */
  outcomes: Array<{
    operationId: OperationId;
    ok: boolean;
    verified: boolean;
    reason?: string;
    count: number;
    lastAt: string;
  }>;
  capabilitiesObserved?: Partial<Record<CapabilityId, CapabilitySupport>>;
  confidence: number;
  notes?: string[];
}
