import { type AddressInfo, connect, createServer, type Server } from "node:net";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerStationsProxy } from "../stationsProxy.js";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

/** An upstream that records the request head it was sent, answers 101, then echoes. */
async function fakeEndpoint(): Promise<{ port: number; heads: string[] }> {
  const heads: string[] = [];
  const server: Server = createServer((sock) => {
    let buf = "";
    let upgraded = false;
    sock.on("data", (chunk) => {
      if (upgraded) {
        sock.write(chunk);
        return;
      }
      buf += chunk.toString("latin1");
      const end = buf.indexOf("\r\n\r\n");
      if (end < 0) return;
      heads.push(buf.slice(0, end));
      upgraded = true;
      sock.write("HTTP/1.1 101 Switching Protocols\r\n\r\n");
      const rest = buf.slice(end + 4);
      if (rest) sock.write(rest);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  cleanups.push(() => new Promise<void>((r) => server.close(() => r())));
  return { port: (server.address() as AddressInfo).port, heads };
}

async function relay(upstreamPort: number): Promise<number> {
  const app: FastifyInstance = Fastify();
  registerStationsProxy(app, {
    target: { host: "127.0.0.1", port: upstreamPort },
    extraOrigins: new Set(),
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  cleanups.push(() => app.close());
  return (app.server.address() as AddressInfo).port;
}

/** Send an upgrade request and collect everything that comes back until `until` matches or the socket ends. */
function upgrade(
  port: number,
  origin: string | null,
  path = "/stations",
  extra = "",
): Promise<string> {
  return new Promise((resolve) => {
    const sock = connect(port, "127.0.0.1");
    let got = "";
    sock.on("data", (c) => {
      got += c.toString("latin1");
      if (got.includes("echo-me")) sock.end();
    });
    sock.on("close", () => resolve(got));
    sock.write(
      `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n${origin ? `Origin: ${origin}\r\n` : ""}\r\n${extra}`,
    );
    setTimeout(() => sock.destroy(), 2000).unref();
  });
}

describe("the /stations proxy", () => {
  it("carries a main screen's socket through to the endpoint, headers and all", async () => {
    const endpoint = await fakeEndpoint();
    const port = await relay(endpoint.port);
    const got = await upgrade(
      port,
      "https://ksp-gonogo.github.io",
      "/stations",
      "echo-me",
    );
    expect(got).toMatch(/^HTTP\/1.1 101/);
    expect(got).toContain("echo-me");
    expect(endpoint.heads).toHaveLength(1);
    expect(endpoint.heads[0]).toMatch(/^GET \/stations HTTP\/1.1/);
    expect(endpoint.heads[0]).toContain("Origin: https://ksp-gonogo.github.io");
  });

  it("refuses a page that is not the app, without reaching the endpoint", async () => {
    const endpoint = await fakeEndpoint();
    const port = await relay(endpoint.port);
    expect(await upgrade(port, "https://evil.example")).toMatch(
      /^HTTP\/1.1 403/,
    );
    expect(await upgrade(port, null)).toMatch(/^HTTP\/1.1 403/);
    expect(endpoint.heads).toHaveLength(0);
  });

  it("answers 503 while the endpoint is not running", async () => {
    const endpoint = await fakeEndpoint();
    const port = await relay(endpoint.port);
    await cleanups.shift()?.();
    expect(await upgrade(port, "http://localhost:5173")).toMatch(
      /^HTTP\/1.1 503/,
    );
  });

  it("refuses an upgrade on any other path", async () => {
    const endpoint = await fakeEndpoint();
    const port = await relay(endpoint.port);
    expect(await upgrade(port, "http://localhost:5173", "/elsewhere")).toMatch(
      /^HTTP\/1.1 404/,
    );
    expect(endpoint.heads).toHaveLength(0);
  });
});
