/**
 * Universal Router Manager — core package public API.
 *
 * Universal Router Adaptation System:
 *   Discover → Fingerprint → Detect capabilities → Select adapter →
 *   Execute supported operation → Verify result → Report unsupported clearly.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 * محمد إبراهيم أبو العز
 */

export const APP_META = {
  name: 'Universal Router Manager',
  nameAr: 'مدير الراوتر الشامل',
  version: '1.0.0',
  developer: {
    ar: 'محمد إبراهيم أبو العز',
    en: 'Mohamed Ibrahim Abu El-Ezz',
  },
  copyright: '© 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.',
  identity: 'ABU ELAZ ULTRA MAN',
  tagline: 'Universal Router Adaptation System',
} as const;

/* core -------------------------------------------------------------- */
export * from './core/types';
export * from './core/errors';
export * from './core/util';
export * from './core/logger';
export * from './core/http';
export * from './core/notifications';

/* signatures -------------------------------------------------------- */
export { RouterSignatures } from './signatures/database';
export { BUILTIN_SIGNATURES, BUILTIN_META } from './signatures/builtin';
export { OUI_TABLE, lookupOui, guessDeviceKind } from './signatures/oui';
export type {
  RouterSignature,
  SignatureMatchSpec,
  SignatureOperation,
  SignatureApiMap,
  WeightedPattern,
  SignatureDatabaseMeta,
  LearnedProfile,
} from './signatures/types';

/* fingerprinting ---------------------------------------------------- */
export { RouterFingerprintEngine, qualityFromScore, qualityLabel } from './fingerprinting/engine';
export { rankSignatures, scoreSignature } from './fingerprinting/matcher';

/* capabilities ------------------------------------------------------ */
export {
  CapabilityDetector,
  ALL_CAPABILITIES,
  capabilityForOperation,
  capabilityState,
  isSupported,
} from './capabilities/detector';

/* router engine ----------------------------------------------------- */
export { UniversalRouterEngine } from './router_engine/engine';
export type { EngineEvents, EngineOptions, ConnectOptions, ConnectResult, EnginePhase, PhaseEvent } from './router_engine/engine';
export { RouterDiscovery, COMMON_GATEWAYS } from './router_engine/discovery';
export type { DiscoveryOptions, DiscoveryProgress } from './router_engine/discovery';

/* adapters ---------------------------------------------------------- */
export { BaseRouterAdapter } from './adapters/base';
export { GenericRouterAdapter } from './adapters/generic';
export { HuaweiAdapter, TPLinkAdapter, ZTEAdapter, DLinkAdapter } from './adapters/vendors';
export { AdapterRegistry, createDefaultRegistry, KNOWN_ADAPTERS } from './adapters/registry';
export { CAPABILITY_LABELS_AR, capabilityLabel, emptyAdapterState } from './adapters/types';
export type { AdapterContext, AdapterState, RouterAdapter, LoginResult } from './adapters/types';
export * from './adapters/parsing';

/* authentication ---------------------------------------------------- */
export {
  FormSessionStrategy,
  HttpAuthStrategy,
  TokenLoginStrategy,
  defaultStrategies,
  discoverLoginFields,
  detectCaptcha,
  applyPasswordTransform,
} from './authentication/strategies';
export type { LoginContext, LoginOutcome, LoginStrategy, PasswordTransform } from './authentication/strategies';

/* verification ------------------------------------------------------ */
export { VerificationEngine } from './verification/engine';
export type { VerificationRequest, ReadBackSpec, ResponseAssertSpec } from './verification/engine';

/* devices / wifi / bandwidth / security ----------------------------- */
export { InternetMonitor, createFetchLatencyProbe } from './diagnostics/monitor';
export type { MonitorSample, ProbeResult, MonitorOptions } from './diagnostics/monitor';
export { createHttpSpeedTestBackend, createSimulatedSpeedTestBackend } from './diagnostics/speedtest';
export type { SpeedTestBackend, SpeedTestOptions, SimulatedProfile } from './diagnostics/speedtest';
export { SecurityCenter, unknownDevices } from './security/center';
export type { SecurityFinding, SecurityReport, SecurityStatus } from './security/center';

/* smart fix + assistant --------------------------------------------- */
export { SmartFixEngine } from './smart_fix/engine';
export type { SmartFixPlan, SmartFixAction, SmartFixApplyResult, SmartFixStep, SmartFixAnalysisInput } from './smart_fix/engine';
export { SmartAssistant } from './smart_fix/assistant';
export type { AssistantContext, AssistantIntent, AssistantReply } from './smart_fix/assistant';

/* storage ----------------------------------------------------------- */
export { LearningStore } from './storage/learning';
export { MemoryStore, SessionCredentialVault } from './storage/types';
export type { CredentialVault, KeyValueStore, SavedRouter } from './storage/types';

/* simulator --------------------------------------------------------- */
export * from './simulated';
export * from './host';
export * from './fingerprinting/upnp';
