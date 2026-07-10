import { synthesizeFlight } from "@ksp-gonogo/data/replay";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createReplayServer, type RunningReplayServer } from "../server";

const FIXTURE = synthesizeFlight({
  vesselName: "WS Test",
  launchedAt: 1_000_000,
  samples: {
    "v.altitude": [
      [0, 100],
      [200, 250],
      [400, 500],
    ],
    "v.body": [[0, "Kerbin"]],
  },
});

let server: RunningReplayServer | null = null;

afterEach(async () => {
  if (server) {
    await server.stop();
    server = null;
  }
});

async function nextMessage(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: WebSocket.Data) => {
      ws.off("message", onMessage);
      ws.off("error", onError);
      resolve(JSON.parse(data.toString()));
    };
    const onError = (err: Error) => {
      ws.off("message", onMessage);
      ws.off("error", onError);
      reject(err);
    };
    ws.on("message", onMessage);
    ws.on("error", onError);
  });
}

async function bootServer(
  rate = 100,
): Promise<{ wsUrl: string; httpUrl: string }> {
  server = await createReplayServer({
    fixture: FIXTURE,
    rate,
    tickMs: 50,
  });
  // Port 0 → let the OS pick. Resolve back via fastify's address.
  const address = await server.fastify.listen({ port: 0, host: "127.0.0.1" });
  return {
    wsUrl: `${address.replace(/^http/, "ws")}/datalink`,
    httpUrl: address,
  };
}

describe("createReplayServer — WebSocket wire", () => {
  it("streams subscribed keys back as plain JSON updates", async () => {
    const { wsUrl } = await bootServer(100); // 100× wall-clock to burn through fast
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve) => ws.once("open", () => resolve()));

    ws.send(JSON.stringify({ "+": ["v.altitude"], rate: 100 }));

    const msg = (await nextMessage(ws)) as Record<string, unknown>;
    expect(msg).toHaveProperty("v.altitude");
    expect(typeof msg["v.altitude"]).toBe("number");

    ws.close();
  });

  it("respects unsubscribes — `-` stops the stream for that key", async () => {
    const { wsUrl } = await bootServer(100);
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve) => ws.once("open", () => resolve()));

    ws.send(JSON.stringify({ "+": ["v.altitude"], rate: 50 }));
    await nextMessage(ws); // first batch

    ws.send(JSON.stringify({ "-": ["v.altitude"] }));

    // After unsubscribe, no more messages — race a 200ms timeout against any
    // arrival. The timeout winning is the success case.
    const result = await Promise.race([
      nextMessage(ws).then(() => "received" as const),
      new Promise<"silent">((resolve) =>
        setTimeout(() => resolve("silent"), 200),
      ),
    ]);
    expect(result).toBe("silent");

    ws.close();
  });

  it("exposes /replay/info with fixture metadata", async () => {
    const { httpUrl } = await bootServer();
    const res = await fetch(`${httpUrl}/replay/info`);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.flight).toMatchObject({ vesselName: "WS Test" });
    expect(body.duration).toBe(400);
    expect(body.chapters).toEqual([]);
  });

  it("records execute calls in the replay's executeLog", async () => {
    const { httpUrl } = await bootServer();
    await fetch(`${httpUrl}/telemachus/datalink?a=f.stage`);
    await fetch(`${httpUrl}/telemachus/datalink?a=f.setThrottle%5B0.5%5D`);
    if (!server) throw new Error("server should be running");
    expect(server.replay.executeLog).toEqual(["f.stage", "f.setThrottle[0.5]"]);
  });
});
