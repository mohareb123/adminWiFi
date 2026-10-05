/**
 * Universal Router Manager — Core domain model.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 * Original source header — Universal Router Adaptation System.
 */

/* ------------------------------------------------------------------ *
 * Discovery
 * ------------------------------------------------------------------ */

export type TransportKind = 'browser' | 'bridge' | 'native' | 'simulated';

export interface TransportCapabilities {
  kind: TransportKind;
  /** Can the transport read the OS routing table (default gateway)? */
  canReadRoutingTable: boolean;
  /** Can the transport reach private/LAN addresses directly? */
  canReachLan: boolean;
  /** Can the transport resolve MAC/ARP entries for LAN peers? */
  canReadArp: boolean;
  /** Can the transport send ICMP echo / TCP-connect latency probes? */
  canProbeLatency: boolean;
  /** Can the transport run an accurate internet speed test server-side? */
  canMeasureInternetSpeed: boolean;
  /** Can the transport issue SNMP reads (only when explicitly enabled)? */
  canSnmp: boolean;
  /** Human readable name of the transport layer, shown in Advanced Mode. */
  label: string;
}

export interface ManagementInterface {
  /** Base URL, e.g. https://192.168.1.1 */
  baseUrl: string;
  host: string;
  scheme: 'http' | 'https';
  port: number;
  reachable: boolean;
  status?: number;
  title?: string;
  server?: string;
  wwwAuthenticate?: string;
  setCookieNames?: string[];
  contentType?: string;
  latencyMs?: number;
  /** Detectable non-HTTP administrative services (advertised, not attacked). */
  services?: DetectedService[];
  error?: string;
}

export interface DetectedService {
  port: number;
  protocol: 'http' | 'https' | 'tr069' | 'upnp' | 'snmp' | 'ssh' | 'telnet' | 'dns' | 'dhcp' | 'mdns';
  /** Whether opening the port succeeded (a "handshake", never a login attempt). */
  open: boolean;
  detail?: string;
}

export interface DiscoveryReport {
  transport: TransportCapabilities;
  /** Default gateway(s) reported by the OS/bridge, best first. */
  gatewayCandidates: string[];
  /** Private-network host candidates worth probing (small, bounded list). */
  hostCandidates: string[];
  interfaces: ManagementInterface[];
  best?: ManagementInterface;
  scannedAt: string;
  durationMs: number;
  notes: string[];
  /** True when nothing administrative could be found. */
  empty: boolean;
}

/* ------------------------------------------------------------------ *
 * Fingerprinting
 * ------------------------------------------------------------------ */

export interface FingerprintSignals {
  gatewayIp: string;
  scheme: 'http' | 'https';
  /** HTTP response headers of the management root (lowercased keys). */
  headers: Record<string, string>;
  title?: string;
  /** Generator/software meta tags. */
  metaGenerator?: string;
  /** Hostnames/realms from WWW-Authenticate. */
  authRealm?: string;
  cookieNames: string[];
  /** Asset paths (css/js) referenced by the login page. */
  assetPaths: string[];
  /** Inline HTML attribute fingerprints (input names/ids, form actions). */
  formFields: string[];
  formAction?: string;
  /** Login-page visible text, trimmed. */
  pageText?: string;
  /** Byte length of the root document (weak but sometimes telling). */
  pageSize?: number;
  /** Known API endpoints that answered on this host. */
  apiHits: ApiHit[];
  /** MAC address of the gateway (OUI lookup) when discoverable. */
  gatewayMac?: string;
  /** UPnP / TR-064 device description, when advertised and readable. */
  upnp?: UpnpInfo;
  /** SNMP sysDescr — only collected when the user explicitly enables SNMP. */
  snmpSysDescr?: string;
  /** Server banner derived from any of the above. */
  serverBanner?: string;
  [key: string]: unknown;
}

export interface ApiHit {
  path: string;
  method: string;
  status: number;
  /** Short sample of the body used for signature matching. */
  sample?: string;
  contentType?: string;
  /**
   * True when the answer actually looked like data (JSON/XML).
   *
   * Plenty of firmware answer *every* path with 200 + the shell HTML page
   * ("soft 404"). Those hits must not be trusted as API evidence, otherwise the
   * engine would happily identify a device that exposes nothing (spec §3).
   */
  dataLike?: boolean;
}

export interface UpnpInfo {
  friendlyName?: string;
  manufacturer?: string;
  modelName?: string;
  modelNumber?: string;
  firmwareVersion?: string;
  deviceType?: string;
  serialNumber?: string;
  presentationUrl?: string;
  services?: string[];
}

export interface Evidence {
  /** Which signal produced this evidence. */
  signal: string;
  /** Observed value (never contains credentials). */
  observed: string;
  /** Signature-ish expectation that matched. */
  matched: string;
  /** Contribution to the confidence score in [0,1]. */
  weight: number;
  /** Positive evidence boosts, negative evidence penalises. */
  polarity: 'positive' | 'negative' | 'neutral';
  detail?: string;
}

export interface FingerprintCandidate {
  signatureId: string;
  vendor: string;
  model: string;
  adapter: string;
  /** Normalised score in [0,1]. */
  score: number;
  /** Display percentage, e.g. 98. */
  confidence: number;
  evidence: Evidence[];
}

export interface RouterIdentity {
  vendor: string;
  vendorRaw?: string;
  model: string;
  modelRaw?: string;
  firmware?: string;
  hardwareVersion?: string;
  serialNumber?: string;
  deviceClass?: string;
  /** OUI-derived vendor of the gateway MAC, when available. */
  ouiVendor?: string;
}

export type FingerprintQuality = 'exact' | 'high' | 'medium' | 'low' | 'unknown';

export interface FingerprintReport {
  identity: RouterIdentity;
  quality: FingerprintQuality;
  confidence: number;
  candidates: FingerprintCandidate[];
  evidence: Evidence[];
  signals: FingerprintSignals;
  /** Per advisory text, e.g. "Router detected with limited confidence." */
  advisories: string[];
  /** Which adapter id the engine should instantiate. */
  recommendedAdapterId: string;
  /** True when the top candidate is not trustworthy enough to special-case. */
  useGenericAdapter: boolean;
  capturedAt: string;
}

/* ------------------------------------------------------------------ *
 * Capabilities
 * ------------------------------------------------------------------ */

export type CapabilityId =
  | 'connected_devices'
  | 'device_block'
  | 'device_rename'
  | 'device_details'
  | 'bandwidth_control'
  | 'per_device_stats'
  | 'wifi'
  | 'wifi_ssid'
  | 'wifi_password'
  | 'wifi_5ghz'
  | 'wifi_channels'
  | 'wifi_security_mode'
  | 'wifi_scan'
  | 'guest_network'
  | 'dhcp'
  | 'dns'
  | 'qos'
  | 'firewall'
  | 'port_forwarding'
  | 'reboot'
  | 'wan_info'
  | 'lan_info'
  | 'firmware_info'
  | 'traffic_stats'
  | 'backup'
  | 'restore'
  | 'upnp'
  | 'ddns'
  | 'vpn'
  | 'snmp'
  | 'logs';

export type CapabilitySupport = 'yes' | 'no' | 'unknown';

export interface CapabilityState {
  id: CapabilityId;
  supported: CapabilitySupport;
  /** Confidence in [0,1] that `supported` is accurate. */
  confidence: number;
  source: 'signature' | 'probe' | 'observed' | 'heuristic' | 'unsupported-signature';
  reason: string;
  verifiedAt?: string;
  /** Non-fatal note shown in Advanced Mode → Capabilities. */
  note?: string;
}

export interface CapabilityReport {
  states: CapabilityState[];
  detectedAt: string;
  durationMs: number;
  probesRun: number;
  probesFailed: number;
}

/* ------------------------------------------------------------------ *
 * Adapters
 * ------------------------------------------------------------------ */

export interface AdapterInfo {
  id: string;
  vendor: string;
  displayName: string;
  /** Signature that led to this adapter, when any. */
  signatureId?: string;
  /** True when this is the fallback heuristic adapter. */
  generic: boolean;
  notes?: string[];
}

export interface LoginRecipe {
  kind:
    | 'form-session'
    | 'form-session-token'
    | 'http-basic'
    | 'http-digest'
    | 'token-bearer'
    | 'vendor-custom';
  loginUrl: string;
  /** Field names discovered on the login form. */
  usernameField?: string;
  passwordField?: string;
  /** Extra fields the form requires (csrf/token/hidden inputs). */
  extraFields?: Record<string, string>;
  tokenEndpoint?: string;
  successProbe?: string;
  failureBodyPatterns?: string[];
  notes?: string;
}

/* ------------------------------------------------------------------ *
 * Credentials, sessions, operations
 * ------------------------------------------------------------------ */

export interface RouterCredentials {
  username: string;
  password: string;
  /** Optional pre-existing session token/cookie supplied by the user. */
  sessionToken?: string;
}

export interface RouterTarget {
  /** Stable id used for storage and multi-router support. */
  id: string;
  label: string;
  host: string;
  scheme: 'http' | 'https';
  port: number;
  /** Optional stored credential reference (never a plaintext password). */
  credentialRef?: string;
}

export type OperationId =
  | 'wifi.set_ssid'
  | 'wifi.set_password'
  | 'wifi.set_channel'
  | 'wifi.set_security'
  | 'wifi.set_band_enabled'
  | 'wifi.set_guest_network'
  | 'device.block'
  | 'device.unblock'
  | 'device.rename'
  | 'device.limit_bandwidth'
  | 'device.clear_limit'
  | 'dns.set'
  | 'dhcp.set_pool'
  | 'dhcp.set_lease'
  | 'qos.set_rule'
  | 'qos.remove_rule'
  | 'firewall.set_level'
  | 'port_forward.add'
  | 'port_forward.remove'
  | 'router.reboot'
  | 'router.backup'
  | 'router.restore'
  | 'wan.set_mtu'
  | 'wan.reconnect';

export interface OperationRequest<P = Record<string, unknown>> {
  id: OperationId;
  params: P;
  /** Caller-provided confirmation flag for sensitive operations. */
  confirmed?: boolean;
}

export interface OperationResult<P = Record<string, unknown>> {
  operationId: OperationId;
  ok: boolean;
  /** Was the change accepted *and* read back successfully? */
  verified: boolean;
  appliedAt: string;
  durationMs: number;
  /** Arabic-first, user-facing message safe for Simple Mode. */
  message: string;
  messageEn: string;
  /** Technical detail surfaced only in Advanced Mode. */
  technical?: {
    status?: number;
    url?: string;
    request?: unknown;
    responseSample?: string;
    /** Extra, non-secret explanation for Advanced Mode. */
    detail?: string;
  };
  /** Reason the operation was rejected (locale-agnostic code). */
  reason?:
    | 'unsupported'
    | 'not-authenticated'
    | 'invalid-params'
    | 'device-rejected'
    | 'verification-failed'
    | 'network-error'
    | 'cancelled'
    | 'needs-confirmation'
    | 'timeout';
  params?: P;
  verification?: VerificationResult;
}

export interface RouterSessionInfo {
  sessionId: string;
  target: RouterTarget;
  identity: RouterIdentity;
  fingerprint: FingerprintReport;
  adapter: AdapterInfo;
  capabilities: CapabilityReport;
  loginRecipe: LoginRecipe;
  authenticatedAt: string;
}

/* ------------------------------------------------------------------ *
 * Verification (Verification Engine)
 * ------------------------------------------------------------------ */

export type VerificationOutcome = 'verified' | 'accepted-unverified' | 'rejected' | 'unknown';

export interface VerificationResult {
  outcome: VerificationOutcome;
  /** Which strategy confirmed the change. */
  strategy: 'read-back' | 'response-assert' | 'status-only' | 'custom' | 'none';
  attempts: number;
  evidence?: string;
  detail?: string;
  checkedAt: string;
}

/* ------------------------------------------------------------------ *
 * Network snapshot / devices / wifi / stats
 * ------------------------------------------------------------------ */

export type DeviceConnection = 'wifi' | 'wifi-2.4' | 'wifi-5' | 'ethernet' | 'unknown';

export interface DeviceRecord {
  id: string;
  name: string;
  hostname?: string;
  ip: string;
  mac: string;
  connection: DeviceConnection;
  signal?: number;
  vendor?: string;
  blocked: boolean;
  /** Active bandwidth limit in kbps, when one is applied. */
  limitKbpsDown?: number;
  limitKbpsUp?: number;
  firstSeen?: string;
  lastSeen?: string;
  /** Instantaneous rates in kbps. */
  rateDownKbps?: number;
  rateUpKbps?: number;
  /** Accumulated usage in kilobytes for the current session/day. */
  usageKb?: number;
  isRouter?: boolean;
  isUnknown?: boolean;
  /** Friendly device class derived from vendor/hostname (e.g. "Android phone"). */
  kind?: string;
  raw?: Record<string, unknown>;
}

export interface WifiBandInfo {
  band: '2.4GHz' | '5GHz';
  ssid: string;
  enabled: boolean;
  channel?: number;
  width?: string;
  security?: string;
  hidden?: boolean;
  guest?: boolean;
  clients?: number;
}

export interface WifiState {
  bands: WifiBandInfo[];
  guestEnabled?: boolean;
  wpsEnabled?: boolean;
  txPower?: string;
}

export interface WifiNeighbor {
  ssid: string;
  bssid?: string;
  band: '2.4GHz' | '5GHz';
  channel: number;
  signalDbm: number;
  security?: string;
}

export interface WanState {
  ip?: string;
  gateway?: string;
  dns: string[];
  connectionType?: string;
  uptimeSeconds?: number;
  mtu?: number;
  status?: string;
  publicIp?: string;
  mac?: string;
  bytesDownKb?: number;
  bytesUpKb?: number;
}

export interface LanState {
  ip: string;
  netmask: string;
  dhcpEnabled: boolean;
  poolStart?: string;
  poolEnd?: string;
  leaseHours?: number;
  clientCount?: number;
}

export interface BandwidthSample {
  at: number;
  downKbps: number;
  upKbps: number;
  /** Per-device rates keyed by device id. */
  perDevice?: Record<string, { downKbps: number; upKbps: number }>;
}

export interface NetworkSnapshot {
  takenAt: string;
  internet: {
    connected: boolean;
    latencyMs?: number;
    jitterMs?: number;
    packetLossPct?: number;
    downKbps?: number;
    upKbps?: number;
  };
  wifi: WifiState;
  wan: WanState;
  lan: LanState;
  devices: DeviceRecord[];
  counts: {
    devices: number;
    online: number;
    blocked: number;
    wifi: number;
    ethernet: number;
  };
  /** Serialised size hints for Advanced Mode. */
  diagnostics?: Record<string, unknown>;
}

export interface SpeedTestResult {
  pingMs: number;
  jitterMs: number;
  downloadMbps: number;
  uploadMbps: number;
  serverLabel: string;
  testedAt: string;
  /** How the measurement was performed so the UI can be honest about it. */
  method: 'bridge-server-side' | 'browser-direct' | 'device-local' | 'simulated';
  samplesDown: number[];
  samplesUp: number[];
  durationMs: number;
}
