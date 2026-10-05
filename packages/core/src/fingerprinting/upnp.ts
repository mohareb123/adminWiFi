/**
 * UPnP / TR-064 device-description parsing.
 *
 * Shared by the desktop bridge (SSDP discovery over UDP) and the Android shell
 * (HTTP fetch of the description XML), so both feed the fingerprint engine the
 * exact same structured signal.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import type { UpnpInfo } from '../core/types';

export function parseDeviceDescription(xml: string): UpnpInfo {
  const grab = (tag: string): string | undefined => {
    const match = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i').exec(xml);
    return match?.[1]?.trim() || undefined;
  };
  const services = [...xml.matchAll(/<serviceType>([^<]+)<\/serviceType>/gi)].map((match) => match[1] as string);
  return {
    friendlyName: grab('friendlyName'),
    manufacturer: grab('manufacturer'),
    modelName: grab('modelName'),
    modelNumber: grab('modelNumber'),
    firmwareVersion: grab('firmwareVersion') ?? grab('softwareVersion'),
    deviceType: grab('deviceType'),
    serialNumber: grab('serialNumber'),
    presentationUrl: grab('presentationURL'),
    services,
  };
}

/**
 * Common locations of an IGD/TR-064 description on a home gateway. Ordered by
 * how often real firmwares use them; the caller must stay within a small budget.
 */
export const UPNP_DESCRIPTION_PATHS = [
  '/rootDesc.xml',
  '/tr64desc.xml',
  '/desc.xml',
  '/upnp/IGD.xml',
  '/InternetGatewayDevice.xml',
  '/cgi-bin/igd.xml',
  '/uuid.xml',
] as const;
