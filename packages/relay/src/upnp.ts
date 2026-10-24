import { createSocket } from "node:dgram";
import { exchange } from "./natPmp.js";

export const SSDP_PORT = 1900;

const SEARCH_TARGETS = [
  "urn:schemas-upnp-org:device:InternetGatewayDevice:1",
  "urn:schemas-upnp-org:device:InternetGatewayDevice:2",
];

const WAN_SERVICES = [
  "urn:schemas-upnp-org:service:WANIPConnection:2",
  "urn:schemas-upnp-org:service:WANIPConnection:1",
  "urn:schemas-upnp-org:service:WANPPPConnection:1",
];

export type UpnpProtocol = "UDP" | "TCP";

/** The control endpoint of the service a router opens its public ports through. */
export interface Igd {
  controlUrl: string;
  serviceType: string;
  /** The router's `SERVER` header, naming its firmware. */
  server: string;
}

export interface UpnpTarget {
  gateway: string;
  /** The router's discovery port; only a test stands in a different one. */
  ssdpPort?: number;
  timeoutMs: number;
  /** Replaced by a test; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

/** A UPnP request the router answered with an error, carrying the router's own error code. */
export class UpnpFault extends Error {
  constructor(
    readonly code: number,
    description: string,
  ) {
    super(description ? `${description} (UPnP ${code})` : `UPnP error ${code}`);
  }
}

function search(st: string): Buffer {
  return Buffer.from(
    [
      "M-SEARCH * HTTP/1.1",
      "HOST: 239.255.255.250:1900",
      'MAN: "ssdp:discover"',
      "MX: 1",
      `ST: ${st}`,
      "",
      "",
    ].join("\r\n"),
  );
}

function header(response: string, name: string): string | null {
  const match = new RegExp(`^${name}:[ \\t]*(.+)$`, "im").exec(response);
  return match?.[1]?.trim() ?? null;
}

function tag(xml: string, name: string): string | null {
  const match = new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml);
  return match?.[1]?.trim() ?? null;
}

async function fetchText(
  target: UpnpTarget,
  url: string,
  init?: RequestInit,
): Promise<{ status: number; body: string }> {
  const doFetch = target.fetchImpl ?? fetch;
  const res = await doFetch(url, {
    ...init,
    signal: AbortSignal.timeout(Math.max(target.timeoutMs * 8, 3000)),
  });
  return { status: res.status, body: await res.text() };
}

/**
 * Find the service a router opens its public ports through of the router at `gateway`. The search goes
 * to the router's address directly because multicast does not leave a
 * container's virtual network. A description that points at any other host is
 * ignored, so a device answering for the router cannot steer the relay's
 * requests elsewhere.
 */
export async function discoverIgd(target: UpnpTarget): Promise<Igd | null> {
  const probe = { ...target, port: target.ssdpPort ?? SSDP_PORT };
  let location: string | null = null;
  let server = "";
  for (const st of SEARCH_TARGETS) {
    const found = await exchange(probe, search(st), (msg) => {
      const text = msg.toString("latin1");
      if (!text.startsWith("HTTP/1.1 200")) return null;
      const where = header(text, "LOCATION");
      return where ? { where, server: header(text, "SERVER") ?? "" } : null;
    });
    if (found) {
      location = found.where;
      server = found.server;
      break;
    }
  }
  if (!location) return null;
  let base: URL;
  try {
    base = new URL(location);
  } catch {
    return null;
  }
  if (base.hostname !== target.gateway || base.protocol !== "http:") {
    return null;
  }
  const description = await fetchText(target, base.href);
  if (description.status !== 200) return null;
  for (const serviceType of WAN_SERVICES) {
    const at = description.body.indexOf(
      `<serviceType>${serviceType}</serviceType>`,
    );
    if (at < 0) continue;
    const control = tag(description.body.slice(at), "controlURL");
    if (!control) continue;
    const controlUrl = new URL(control, base);
    if (controlUrl.hostname !== target.gateway) continue;
    return { controlUrl: controlUrl.href, serviceType, server };
  }
  return null;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function soap(
  target: UpnpTarget,
  igd: Igd,
  action: string,
  args: [string, string | number][],
): Promise<string> {
  const body = [
    '<?xml version="1.0"?>',
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">',
    "<s:Body>",
    `<u:${action} xmlns:u="${igd.serviceType}">`,
    ...args.map(([k, v]) => `<${k}>${escapeXml(String(v))}</${k}>`),
    `</u:${action}>`,
    "</s:Body></s:Envelope>",
  ].join("");
  const res = await fetchText(target, igd.controlUrl, {
    method: "POST",
    headers: {
      "Content-Type": 'text/xml; charset="utf-8"',
      SOAPAction: `"${igd.serviceType}#${action}"`,
    },
    body,
  });
  if (res.status !== 200) {
    throw new UpnpFault(
      Number(tag(res.body, "errorCode") ?? res.status),
      tag(res.body, "errorDescription") ?? `HTTP ${res.status}`,
    );
  }
  return res.body;
}

export interface UpnpMapping {
  protocol: UpnpProtocol;
  port: number;
}

/**
 * Forward `port` on the router's public address to `internalClient` on the
 * same port. A router that accepts only permanent mappings (code 725) is asked
 * again with a lease of 0, which the caller removes on stop.
 */
export async function addPortMapping(
  target: UpnpTarget,
  igd: Igd,
  mapping: UpnpMapping & { internalClient: string; leaseSeconds: number },
): Promise<void> {
  const send = (lease: number) =>
    soap(target, igd, "AddPortMapping", [
      ["NewRemoteHost", ""],
      ["NewExternalPort", mapping.port],
      ["NewProtocol", mapping.protocol],
      ["NewInternalPort", mapping.port],
      ["NewInternalClient", mapping.internalClient],
      ["NewEnabled", 1],
      ["NewPortMappingDescription", "gonogo relay"],
      ["NewLeaseDuration", lease],
    ]);
  try {
    await send(mapping.leaseSeconds);
  } catch (err) {
    if (!(err instanceof UpnpFault) || err.code !== 725) throw err;
    await send(0);
  }
}

export async function deletePortMapping(
  target: UpnpTarget,
  igd: Igd,
  mapping: UpnpMapping,
): Promise<void> {
  await soap(target, igd, "DeletePortMapping", [
    ["NewRemoteHost", ""],
    ["NewExternalPort", mapping.port],
    ["NewProtocol", mapping.protocol],
  ]);
}

/** The internal address a mapping forwards to, or null when the router holds no such mapping. */
export async function getPortMapping(
  target: UpnpTarget,
  igd: Igd,
  mapping: UpnpMapping,
): Promise<{ internalClient: string; internalPort: number } | null> {
  try {
    const xml = await soap(target, igd, "GetSpecificPortMappingEntry", [
      ["NewRemoteHost", ""],
      ["NewExternalPort", mapping.port],
      ["NewProtocol", mapping.protocol],
    ]);
    return {
      internalClient: tag(xml, "NewInternalClient") ?? "",
      internalPort: Number(tag(xml, "NewInternalPort") ?? 0),
    };
  } catch (err) {
    if (err instanceof UpnpFault && err.code === 714) return null;
    throw err;
  }
}

/** The address this machine uses to reach `gateway`, from the socket the system would route through. */
export function localAddressToward(gateway: string): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = createSocket("udp4");
    socket.on("error", () => {
      socket.close();
      resolve(null);
    });
    socket.connect(SSDP_PORT, gateway, () => {
      const { address } = socket.address();
      socket.close();
      resolve(address);
    });
  });
}
