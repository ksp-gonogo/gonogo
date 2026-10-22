import { exchange, type NatPmpTarget } from "./natPmp.js";

const PCP_PORT = 5351;
const SSDP_PORT = 1900;

/** A PCP announce request carries the client address as zeros: it is a liveness check and maps nothing. */
function pcpAnnounce(): Buffer {
  const out = Buffer.alloc(24);
  out.writeUInt8(2, 0);
  return out;
}

const SSDP_SEARCH = Buffer.from(
  [
    "M-SEARCH * HTTP/1.1",
    "HOST: 239.255.255.250:1900",
    'MAN: "ssdp:discover"',
    "MX: 1",
    "ST: urn:schemas-upnp-org:device:InternetGatewayDevice:1",
    "",
    "",
  ].join("\r\n"),
);

/**
 * Whether a router answers PCP or UPnP at this address. Neither can be used to
 * open a port from a container, which cannot name the machine's own network
 * address in the request, so this only lets the relay say what it found.
 */
export async function answersPcpOrUpnp(
  target: NatPmpTarget,
): Promise<"pcp" | "upnp" | null> {
  const pcp = await exchange<"pcp">(
    { ...target, port: PCP_PORT },
    pcpAnnounce(),
    (msg) =>
      msg.length >= 24 && msg[0] === 2 && msg[1] === 0x80 ? "pcp" : null,
  );
  if (pcp) return pcp;
  return exchange<"upnp">({ ...target, port: SSDP_PORT }, SSDP_SEARCH, (msg) =>
    msg.toString("latin1").startsWith("HTTP/1.1 200") ? "upnp" : null,
  );
}
