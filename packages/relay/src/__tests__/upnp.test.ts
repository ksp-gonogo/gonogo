import { createSocket, type Socket } from "node:dgram";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { PortMapper, turnPorts } from "../portMapper.js";
import {
  addPortMapping,
  deletePortMapping,
  discoverIgd,
  getPortMapping,
} from "../upnp.js";

const SERVICE = "urn:schemas-upnp-org:service:WANIPConnection:2";

interface Call {
  action: string;
  args: Record<string, string>;
}

interface FakeOptions {
  /** Host named in the discovery answer's address header. */
  locationHost?: string;
  /** Fault code for AddPortMapping, as a router answers with. */
  addFault?: number;
  /** Fault codes for AddPortMapping that apply only while the lease is not 0. */
  leaseFault?: number;
  /** Stay silent when asked to discover the router. */
  silentSsdp?: boolean;
}

/** A router on the loopback address: a discovery responder, a description document and a control endpoint. */
async function fakeIgd(options: FakeOptions = {}) {
  const calls: Call[] = [];
  const table = new Map<string, string>();
  const http: Server = createServer((req, res) => {
    if (req.method === "GET") {
      res.end(
        `<root><device><serviceList><service><serviceType>${SERVICE}</serviceType><controlURL>/ctl/IPConn</controlURL></service></serviceList></device></root>`,
      );
      return;
    }
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      const action =
        String(req.headers.soapaction).split("#")[1]?.replace('"', "") ?? "";
      const args: Record<string, string> = {};
      for (const m of body.matchAll(/<(New\w+)>([^<]*)<\/\1>/g)) {
        args[m[1] as string] = m[2] as string;
      }
      calls.push({ action, args });
      const key = `${args.NewProtocol}:${args.NewExternalPort}`;
      const fault = (code: number) => {
        res.statusCode = 500;
        res.end(
          `<s:Envelope><s:Body><s:Fault><detail><UPnPError><errorCode>${code}</errorCode><errorDescription>nope</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>`,
        );
      };
      if (action === "AddPortMapping") {
        if (options.addFault) return fault(options.addFault);
        if (options.leaseFault && args.NewLeaseDuration !== "0") {
          return fault(options.leaseFault);
        }
        table.set(key, args.NewInternalClient as string);
        res.end("<ok/>");
        return;
      }
      if (action === "DeletePortMapping") {
        if (!table.delete(key)) return fault(714);
        res.end("<ok/>");
        return;
      }
      if (action === "GetSpecificPortMappingEntry") {
        const client = table.get(key);
        if (!client) return fault(714);
        res.end(
          `<r><NewInternalPort>${args.NewExternalPort}</NewInternalPort><NewInternalClient>${client}</NewInternalClient></r>`,
        );
        return;
      }
      fault(401);
    });
  });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  const httpPort = (http.address() as AddressInfo).port;
  const ssdp: Socket = createSocket("udp4");
  ssdp.on("message", (_msg, rinfo) => {
    if (options.silentSsdp) return;
    const host = options.locationHost ?? "127.0.0.1";
    ssdp.send(
      [
        "HTTP/1.1 200 OK",
        `LOCATION: http://${host}:${httpPort}/rootDesc.xml`,
        "SERVER: Fake/1.0 UPnP/1.1 MiniUPnPd/1.9",
        "",
        "",
      ].join("\r\n"),
      rinfo.port,
      rinfo.address,
    );
  });
  await new Promise<void>((r) => ssdp.bind(0, "127.0.0.1", r));
  const closers = () => {
    ssdp.close();
    http.close();
    http.closeAllConnections();
  };
  fakes.push({ close: closers });
  return { calls, table, ssdpPort: ssdp.address().port };
}

const fakes: { close: () => void }[] = [];
afterEach(() => {
  for (const f of fakes.splice(0)) f.close();
});

const target = (ssdpPort: number) => ({
  gateway: "127.0.0.1",
  ssdpPort,
  timeoutMs: 80,
});

describe("UPnP IGD client", () => {
  it("finds the WAN connection service from the router's own answer", async () => {
    const igd = await fakeIgd();
    const found = await discoverIgd(target(igd.ssdpPort));
    expect(found?.serviceType).toBe(SERVICE);
    expect(found?.controlUrl).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/ctl\/IPConn$/,
    );
    expect(found?.server).toContain("MiniUPnPd");
  });

  it("finds nothing when the router stays silent", async () => {
    const igd = await fakeIgd({ silentSsdp: true });
    expect(await discoverIgd(target(igd.ssdpPort))).toBeNull();
  });

  it("ignores a description that points at another host", async () => {
    const igd = await fakeIgd({ locationHost: "203.0.113.9" });
    expect(await discoverIgd(target(igd.ssdpPort))).toBeNull();
  });

  it("adds, reads back and deletes a mapping", async () => {
    const igd = await fakeIgd();
    const t = target(igd.ssdpPort);
    const found = await discoverIgd(t);
    if (!found) throw new Error("no igd");
    const mapping = { protocol: "UDP" as const, port: 52871 };
    await addPortMapping(t, found, {
      ...mapping,
      internalClient: "198.51.100.24",
      leaseSeconds: 120,
    });
    expect(await getPortMapping(t, found, mapping)).toEqual({
      internalClient: "198.51.100.24",
      internalPort: 52871,
    });
    await deletePortMapping(t, found, mapping);
    expect(await getPortMapping(t, found, mapping)).toBeNull();
  });

  it("asks again for a permanent mapping when the router takes no lease", async () => {
    const igd = await fakeIgd({ leaseFault: 725 });
    const t = target(igd.ssdpPort);
    const found = await discoverIgd(t);
    if (!found) throw new Error("no igd");
    await addPortMapping(t, found, {
      protocol: "TCP",
      port: 3478,
      internalClient: "198.51.100.24",
      leaseSeconds: 120,
    });
    expect(igd.table.get("TCP:3478")).toBe("198.51.100.24");
  });
});

describe("PortMapper against a router that speaks UPnP only", () => {
  /** NAT-PMP goes to a port nothing listens on, so the router counts as silent for it. */
  async function setup(options: FakeOptions = {}) {
    const igd = await fakeIgd(options);
    const log: string[] = [];
    const mapper = new PortMapper({
      gateways: ["127.0.0.1"],
      ports: turnPorts(3478, 49160, 49162),
      timeoutMs: 40,
      natPmpPort: 9,
      ssdpPort: igd.ssdpPort,
      lanIp: "198.51.100.24",
      probeOthers: async () => null,
      log: (m) => log.push(m),
    });
    return { igd, mapper, log };
  }

  it("maps the TURN port on both protocols and the session window on UDP, and nothing else", async () => {
    const { igd, mapper } = await setup();
    await mapper.start();
    expect(mapper.status.state).toBe("mapped");
    const added = igd.calls
      .filter((c) => c.action === "AddPortMapping")
      .map((c) => `${c.args.NewProtocol}:${c.args.NewExternalPort}`);
    expect(added).toEqual([
      "UDP:3478",
      "TCP:3478",
      "UDP:49160",
      "UDP:49161",
      "UDP:49162",
    ]);
    for (const c of igd.calls) {
      expect(c.args.NewInternalClient).toBe("198.51.100.24");
      expect(c.args.NewLeaseDuration).toBe("3600");
    }
    await mapper.stop();
  });

  it("deletes every mapping on stop", async () => {
    const { igd, mapper } = await setup();
    await mapper.start();
    await mapper.stop();
    expect(igd.table.size).toBe(0);
    expect(
      igd.calls.filter((c) => c.action === "DeletePortMapping"),
    ).toHaveLength(5);
  });

  it("reports a refusal with the router's reason", async () => {
    const { mapper } = await setup({ addFault: 718 });
    await mapper.start();
    expect(mapper.status.state).toBe("refused");
    expect(mapper.status.message).toContain("UPnP 718");
    await mapper.stop();
  });

  it("says nothing was answered when neither protocol is", async () => {
    const { mapper, log } = await setup({ silentSsdp: true });
    await mapper.start();
    expect(mapper.status.state).toBe("no-answer");
    expect(log.at(-1)).toContain(
      "no router answered NAT-PMP or UPnP at 127.0.0.1",
    );
    expect(log.at(-1)).toContain("set ROUTER_IP");
  });
});
