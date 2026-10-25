import { createSocket, type Socket } from "node:dgram";
import { afterEach, describe, expect, it } from "vitest";
import { encodeMappingRequest } from "../natPmp.js";
import { endpointPorts, type MappedPort, PortMapper } from "../portMapper.js";

/** One port on UDP and TCP, then a window on UDP alone: a port list of more than one shape. */
function portList(both: number, from: number, to: number): MappedPort[] {
  const window: MappedPort[] = [];
  for (let port = from; port <= to; port++)
    window.push({ protocol: "udp", port });
  return [
    { protocol: "udp", port: both },
    { protocol: "tcp", port: both },
    ...window,
  ];
}

interface Seen {
  opcode: number;
  internalPort: number;
  externalPort: number;
  lifetime: number;
}

type Mode = "ok" | "refuse" | "silent" | "other-port";

/** A NAT-PMP router on the loopback address: answers like RFC 6886 or stays quiet. */
async function fakeRouter(mode: Mode) {
  const seen: Seen[] = [];
  const socket: Socket = createSocket("udp4");
  socket.on("message", (msg, rinfo) => {
    if (mode === "silent") return;
    const opcode = msg[1] ?? 0;
    const result = mode === "refuse" && opcode !== 0 ? 2 : 0;
    if (opcode === 0) {
      const out = Buffer.alloc(12);
      out.writeUInt8(128, 1);
      out.writeUInt16BE(result, 2);
      out.set([203, 0, 113, 7], 8);
      socket.send(out, rinfo.port, rinfo.address);
      return;
    }
    const req: Seen = {
      opcode,
      internalPort: msg.readUInt16BE(4),
      externalPort: msg.readUInt16BE(6),
      lifetime: msg.readUInt32BE(8),
    };
    seen.push(req);
    const out = Buffer.alloc(16);
    out.writeUInt8(128 + opcode, 1);
    out.writeUInt16BE(result, 2);
    out.writeUInt16BE(req.internalPort, 8);
    out.writeUInt16BE(
      mode === "other-port" ? req.internalPort + 1000 : req.externalPort,
      10,
    );
    out.writeUInt32BE(req.lifetime, 12);
    socket.send(out, rinfo.port, rinfo.address);
  });
  await new Promise<void>((r) => socket.bind(0, "127.0.0.1", r));
  return { seen, port: socket.address().port, close: () => socket.close() };
}

/**
 * For a test that counts the requests the router saw. The fake router answers
 * at once, so a timeout it cannot miss keeps a loaded machine from making the
 * client resend and the router record the same request twice.
 */
const PATIENT = { timeoutMs: 2000 };

const routers: { close: () => void }[] = [];
afterEach(() => {
  for (const r of routers.splice(0)) r.close();
});

async function setup(mode: Mode, extra: object = {}) {
  const router = await fakeRouter(mode);
  routers.push(router);
  const log: string[] = [];
  const mapper = new PortMapper({
    router: "127.0.0.1",
    ports: portList(3478, 49160, 49169),
    timeoutMs: 40,
    natPmpPort: router.port,
    probeOthers: async () => null,
    log: (m) => log.push(m),
    ...extra,
  });
  return { router, mapper, log };
}

describe("PortMapper against a router that speaks NAT-PMP", () => {
  it("maps the relay ports with each published port as the internal port", async () => {
    const { router, mapper, log } = await setup("ok", PATIENT);
    await mapper.start();

    expect(mapper.status.state).toBe("mapped");
    const udp = router.seen.filter((r) => r.opcode === 1);
    expect(udp.map((r) => r.internalPort)).toEqual([
      3478, 49160, 49161, 49162, 49163, 49164, 49165, 49166, 49167, 49168,
      49169,
    ]);
    for (const r of router.seen) expect(r.externalPort).toBe(r.internalPort);
    expect(
      router.seen.some((r) => r.opcode === 2 && r.internalPort === 3478),
    ).toBe(true);
    expect(log.join("\n")).toContain("127.0.0.1 answered NAT-PMP");
    await mapper.stop();
  });

  it("opens the endpoint's one port on UDP and TCP", async () => {
    const { router, mapper } = await setup("ok", {
      ...PATIENT,
      ports: endpointPorts(47100),
    });
    await mapper.start();
    expect(mapper.status.state).toBe("mapped");
    expect(
      router.seen.map((r) => [r.opcode === 1 ? "udp" : "tcp", r.internalPort]),
    ).toEqual([
      ["udp", 47100],
      ["tcp", 47100],
    ]);
    await mapper.stop();
  });

  it("deletes every mapping on stop", async () => {
    const { router, mapper } = await setup("ok", PATIENT);
    await mapper.start();
    const mappedCount = router.seen.length;
    await mapper.stop();

    const deletes = router.seen.slice(mappedCount);
    expect(deletes).toHaveLength(mappedCount);
    for (const d of deletes) {
      expect(d.lifetime).toBe(0);
      expect(d.externalPort).toBe(0);
    }
  });

  it("renews before the lease ends", async () => {
    const { router, mapper } = await setup("ok", { leaseSeconds: 0.2 });
    await mapper.start();
    const first = router.seen.length;
    await new Promise((r) => setTimeout(r, 400));
    await mapper.stop();
    expect(router.seen.length).toBeGreaterThan(first);
  });

  it("says plainly that the router refused", async () => {
    const { mapper } = await setup("refuse");
    await mapper.start();
    expect(mapper.status.state).toBe("refused");
    expect(mapper.status.message).toContain("refused to open the relay's port");
    await mapper.stop();
  });

  it("treats a router offering a different public port as a refusal and removes it", async () => {
    const { router, mapper } = await setup("other-port");
    await mapper.start();
    expect(mapper.status.state).toBe("refused");
    expect(mapper.status.message).toContain("offered port 4478");
    expect(router.seen.at(-1)?.lifetime).toBe(0);
    await mapper.stop();
  });

  it("reports no answer when nothing replies", async () => {
    const { mapper } = await setup("silent");
    await mapper.start();
    expect(mapper.status.state).toBe("no-answer");
    expect(mapper.status.message).toBe("Your router did not answer.");
  });

  it("says the ports could not be opened from a container when only PCP or UPnP answers", async () => {
    const { router, mapper } = await setup("silent", {
      probeOthers: async () => "upnp",
    });
    await mapper.start();
    expect(mapper.status.state).toBe("container-only");
    expect(mapper.status.message).toContain("from inside the container");
    expect(router.seen).toEqual([]);
  });

  it("asks only the router it is given, and says so when that one stays silent", async () => {
    const { router, mapper, log } = await setup("ok", {
      router: "127.0.0.2",
    });
    await mapper.start();
    expect(router.seen).toEqual([]);
    expect(mapper.status.state).toBe("no-answer");
    expect(mapper.status.message).toBe("Your router did not answer.");
    expect(log.at(-1)).toBe("no router answered NAT-PMP or UPnP at 127.0.0.2");
  });
});

describe("wire format", () => {
  it("encodes a UDP and a TCP mapping request per RFC 6886", () => {
    expect([...encodeMappingRequest("udp", 49160, 49160, 3600)]).toEqual([
      0, 1, 0, 0, 0xc0, 0x08, 0xc0, 0x08, 0, 0, 0x0e, 0x10,
    ]);
    expect(encodeMappingRequest("tcp", 3478, 3478, 0)[1]).toBe(2);
  });
});
