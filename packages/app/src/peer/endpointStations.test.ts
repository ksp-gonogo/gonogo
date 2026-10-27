import { ws } from "msw";
import { setupServer } from "msw/node";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { encodeFrames, FrameReader } from "./endpointFraming";
import { EndpointStations } from "./endpointStations";

const URL = "ws://localhost:3002/stations";
const link = ws.link(URL);
const server = setupServer();

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

type Client = Parameters<
  Parameters<typeof link.addEventListener<"connection">>[1]
>[0]["client"];

/** An endpoint that sends its status, then records what the main screen sends it. */
function fakeEndpoint() {
  const control: Record<string, unknown>[] = [];
  const data: { sid: number; bytes: Uint8Array }[] = [];
  let client: Client | null = null;
  server.use(
    link.addEventListener("connection", (event) => {
      client = event.client;
      event.client.send(JSON.stringify({ type: "status", port: 47100 }));
      event.client.addEventListener("message", (m) => {
        if (typeof m.data === "string") {
          control.push(JSON.parse(m.data));
        } else {
          const buf = new Uint8Array(m.data as ArrayBuffer);
          const sid = new DataView(buf.buffer, buf.byteOffset).getUint32(0);
          data.push({ sid, bytes: buf.slice(4) });
        }
      });
    }),
  );
  return {
    control,
    data,
    send: (f: Record<string, unknown>) => client?.send(JSON.stringify(f)),
    sendData: (sid: number, frame: Uint8Array) => {
      const out = new Uint8Array(4 + frame.byteLength);
      new DataView(out.buffer).setUint32(0, sid);
      out.set(frame, 4);
      client?.send(out.buffer);
    },
    close: () => client?.close(),
  };
}

async function started(): Promise<EndpointStations> {
  const stations = new EndpointStations(() => URL);
  stations.start();
  await vi.waitFor(() => expect(stations.available).toBe(true));
  return stations;
}

describe("the main screen's endpoint socket", () => {
  it("is available once the endpoint sends its status", async () => {
    fakeEndpoint();
    const stations = await started();
    stations.stop();
    expect(stations.available).toBe(false);
  });

  it("hands a station's offer to the endpoint and resolves with its answer", async () => {
    const endpoint = fakeEndpoint();
    const stations = await started();
    const { conn, answer } = stations.join("station-a", "v=offer");
    await vi.waitFor(() => expect(endpoint.control).toHaveLength(1));
    const offer = endpoint.control[0] as { sid: number };
    expect(offer).toMatchObject({
      type: "offer",
      peerId: "station-a",
      sdp: "v=offer",
    });
    endpoint.send({ type: "answer", sid: offer.sid, sdp: "v=answer" });
    expect(await answer).toBe("v=answer");
    expect(conn.peer).toBe("station-a");
    expect(conn.open).toBe(false);
    stations.stop();
  });

  it("hands back a connection that hears an open arriving with the answer", async () => {
    const endpoint = fakeEndpoint();
    const stations = await started();
    const { conn } = stations.join("station-a", "v=a");
    const opened = vi.fn();
    conn.on("open", opened);
    await vi.waitFor(() => expect(endpoint.control).toHaveLength(1));
    const sid = endpoint.control[0]?.sid;
    endpoint.send({ type: "answer", sid, sdp: "x" });
    endpoint.send({ type: "open", sid });
    await vi.waitFor(() => expect(opened).toHaveBeenCalledOnce());
    stations.stop();
  });

  it("reads a station's queue as empty once it opens, then as the endpoint reports it", async () => {
    const endpoint = fakeEndpoint();
    const stations = await started();
    const { conn } = stations.join("station-a", "v=a");
    await vi.waitFor(() => expect(endpoint.control).toHaveLength(1));
    const sid = endpoint.control[0]?.sid;
    expect(conn.queuedBytes).toBeNull();

    endpoint.send({ type: "answer", sid, sdp: "x" });
    endpoint.send({ type: "open", sid });
    await vi.waitFor(() => expect(conn.queuedBytes).toBe(0));
    endpoint.send({ type: "queued", sid, bytes: 300_000 });
    await vi.waitFor(() => expect(conn.queuedBytes).toBe(300_000));
    stations.stop();
  });

  it("carries messages each way for each station once it opens, and keeps two stations apart", async () => {
    const endpoint = fakeEndpoint();
    const stations = await started();
    const a = stations.join("station-a", "v=a");
    const b = stations.join("station-b", "v=b");
    await vi.waitFor(() => expect(endpoint.control).toHaveLength(2));
    const [sa, sb] = endpoint.control.map((f) => Number(f.sid));
    endpoint.send({ type: "answer", sid: sa, sdp: "x" });
    endpoint.send({ type: "answer", sid: sb, sdp: "x" });
    await a.answer;
    await b.answer;
    const ca = a.conn;
    const cb = b.conn;
    const opened: string[] = [];
    ca.on("open", () => opened.push("a"));
    cb.on("open", () => opened.push("b"));
    endpoint.send({ type: "open", sid: sa, path: "internet" });
    endpoint.send({ type: "open", sid: sb, path: "lan" });
    await vi.waitFor(() => expect(opened).toEqual(["a", "b"]));
    expect(ca.path).toBe("internet");
    expect(cb.path).toBe("lan");

    const gotA: unknown[] = [];
    const gotB: unknown[] = [];
    ca.on("data", (d) => gotA.push(d));
    cb.on("data", (d) => gotB.push(d));
    for (const f of encodeFrames({ type: "vote", status: "go" }))
      endpoint.sendData(Number(sb), f);
    await vi.waitFor(() =>
      expect(gotB).toEqual([{ type: "vote", status: "go" }]),
    );
    expect(gotA).toEqual([]);

    ca.send({ type: "hello", version: "1" });
    await vi.waitFor(() => expect(endpoint.data).toHaveLength(1));
    expect(endpoint.data[0]?.sid).toBe(sa);
    expect(
      new FrameReader().push(endpoint.data[0]?.bytes ?? new Uint8Array()),
    ).toEqual({
      type: "hello",
      version: "1",
    });
    stations.stop();
  });

  it("rejects a join the endpoint refuses", async () => {
    const endpoint = fakeEndpoint();
    const stations = await started();
    const joining = stations.join("station-a", "v=a");
    await vi.waitFor(() => expect(endpoint.control).toHaveLength(1));
    endpoint.send({
      type: "close",
      sid: endpoint.control[0]?.sid,
      reason: "busy",
    });
    await expect(joining.answer).rejects.toThrow(/busy/);
    expect(joining.conn.open).toBe(false);
    stations.stop();
  });

  it("closes a station when the endpoint closes it, and tells the endpoint when the main screen does", async () => {
    const endpoint = fakeEndpoint();
    const stations = await started();
    const joining = stations.join("station-a", "v=a");
    await vi.waitFor(() => expect(endpoint.control).toHaveLength(1));
    const sid = endpoint.control[0]?.sid;
    endpoint.send({ type: "answer", sid, sdp: "x" });
    const { conn } = joining;
    await joining.answer;
    endpoint.send({ type: "open", sid });
    await vi.waitFor(() => expect(conn.open).toBe(true));
    conn.close();
    await vi.waitFor(() =>
      expect(endpoint.control.at(-1)).toEqual({ type: "close", sid }),
    );

    const again = stations.join("station-b", "v=b");
    await vi.waitFor(() => expect(endpoint.control).toHaveLength(3));
    const sid2 = endpoint.control[2]?.sid;
    endpoint.send({ type: "answer", sid: sid2, sdp: "x" });
    await again.answer;
    const c2 = again.conn;
    endpoint.send({ type: "open", sid: sid2 });
    await vi.waitFor(() => expect(c2.open).toBe(true));
    const closed = vi.fn();
    c2.on("close", closed);
    endpoint.send({ type: "close", sid: sid2, reason: "closed" });
    await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce());
    stations.stop();
  });

  it("drops every station when the socket goes, and refuses a join while it is down", async () => {
    const endpoint = fakeEndpoint();
    const stations = await started();
    const joining = stations.join("station-a", "v=a");
    await vi.waitFor(() => expect(endpoint.control).toHaveLength(1));
    endpoint.send({ type: "answer", sid: endpoint.control[0]?.sid, sdp: "x" });
    await joining.answer;
    const { conn } = joining;
    const closed = vi.fn();
    conn.on("close", closed);
    endpoint.close();
    await vi.waitFor(() => expect(stations.available).toBe(false));
    expect(closed).toHaveBeenCalledOnce();
    await expect(stations.join("station-b", "v").answer).rejects.toThrow(
      /not running/,
    );
    stations.stop();
  });

  it("bridges a station's media offer: the endpoint's upstream offer is answered, and the station's answer comes back", async () => {
    const endpoint = fakeEndpoint();
    const stations = await started();
    const joining = stations.join("station-a", "v=a");
    await vi.waitFor(() => expect(endpoint.control).toHaveLength(1));
    const sid = endpoint.control[0]?.sid;
    endpoint.send({ type: "answer", sid, sdp: "x" });
    await joining.answer;
    endpoint.send({ type: "open", sid });
    await vi.waitFor(() => expect(joining.conn.open).toBe(true));

    const upstream = vi.fn(
      async (offer: string) => `sidecar answer to ${offer}`,
    );
    const bridged = stations.bridge(joining.conn, "v=camera-offer", upstream);
    await vi.waitFor(() =>
      expect(endpoint.control.at(-1)).toMatchObject({
        type: "bridge",
        sid,
        sdp: "v=camera-offer",
      }),
    );
    const bid = endpoint.control.at(-1)?.bid;
    endpoint.send({
      type: "bridge-offer",
      bid,
      sdp: "v=endpoint-upstream-offer",
    });
    await vi.waitFor(() =>
      expect(endpoint.control.at(-1)).toEqual({
        type: "bridge-answer",
        bid,
        sdp: "sidecar answer to v=endpoint-upstream-offer",
      }),
    );
    endpoint.send({
      type: "bridge-ready",
      bid,
      sdp: "v=endpoint-station-answer",
    });
    expect(await bridged).toBe("v=endpoint-station-answer");
    stations.stop();
  });

  it("rejects a bridge the endpoint closes, and tells it when the upstream server refuses", async () => {
    const endpoint = fakeEndpoint();
    const stations = await started();
    const joining = stations.join("station-a", "v=a");
    await vi.waitFor(() => expect(endpoint.control).toHaveLength(1));
    const sid = endpoint.control[0]?.sid;
    endpoint.send({ type: "answer", sid, sdp: "x" });
    await joining.answer;
    endpoint.send({ type: "open", sid });
    await vi.waitFor(() => expect(joining.conn.open).toBe(true));

    const closed = stations.bridge(joining.conn, "v=1", async () => "x");
    await vi.waitFor(() =>
      expect(endpoint.control.at(-1)?.type).toBe("bridge"),
    );
    endpoint.send({
      type: "bridge-close",
      bid: endpoint.control.at(-1)?.bid,
      reason: "no such station",
    });
    await expect(closed).rejects.toThrow(/no such station/);

    const refused = stations.bridge(joining.conn, "v=2", async () => {
      throw new Error("sidecar said 503");
    });
    await vi.waitFor(() =>
      expect(endpoint.control.at(-1)?.type).toBe("bridge"),
    );
    const bid = endpoint.control.at(-1)?.bid;
    endpoint.send({ type: "bridge-offer", bid, sdp: "v=up" });
    await expect(refused).rejects.toThrow(/sidecar said 503/);
    await vi.waitFor(() =>
      expect(endpoint.control.at(-1)).toEqual({ type: "bridge-close", bid }),
    );
    stations.stop();
  });
});
