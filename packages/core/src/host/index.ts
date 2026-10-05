/**
 * Host layer — portable engine host + the `/api/*` route table shared by the
 * desktop bridge and the Android device shell.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

export {
  EngineHost,
} from './engine-host';
export type {
  BridgeMode,
  ConnectRequest,
  EngineHostOptions,
  HostEventMap,
  HostStateSnapshot,
} from './engine-host';
export type {
  HostPlatform,
  HostSpeedPlan,
  HostStorage,
  LatencyProbe,
  LatencyProbeResult,
  SavedRouterRepository,
} from './types';
export { json, routeBridgeRequest } from './router';
export type { BridgeRouteRequest, BridgeRouteResult, BridgeStreamSink } from './router';
