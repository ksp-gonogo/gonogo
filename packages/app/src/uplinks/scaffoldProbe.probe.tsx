import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getComponents } from "@ksp-gonogo/core";
import {
  type WebSocketLike,
  WebSocketTransport,
} from "@ksp-gonogo/sitrep-client";
import { CONTRACT_MAJOR, CONTRACT_MINOR } from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import NodeWebSocket from "ws";
import type { ConsentInfo } from "./consent";
import { hostCompat } from "./hostCompat";
import { loadEnabledUplinks, manifestUrlFor } from "./loader";
import { probeUplinkRoster } from "./rosterProbe";

/*
 * The app's half of scripts/scaffold-probe.mjs, which is the only thing that
 * runs this file. The script has scaffolded an Uplink, built its plugin and is
 * serving the mod's stream from it; this asks the stream which Uplinks are
 * installed the way the app does at boot, hands the answer to the real loader,
 * and looks for the scaffold's widget.
 *
 * The bundle and its sidecar are read from disk at the URL the plugin announced.
 * Fetching them from a CDN, the consent dialog and the browser's import map are
 * what this cannot show.
 */

const need = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. This file is run by scripts/scaffold-probe.mjs, never on its own.`,
    );
  }
  return value;
};

/** The three things the plugin is expected to repeat from the scaffold's `uplink.json`. */
function readDeclaration(path: string) {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  const field = (from: unknown, key: string): unknown =>
    typeof from === "object" && from !== null
      ? Reflect.get(from, key)
      : undefined;
  const name = field(parsed, "name");
  const author = field(parsed, "author");
  const url = field(field(parsed, "client"), "url");
  if (
    typeof name !== "string" ||
    typeof author !== "string" ||
    typeof url !== "string"
  ) {
    throw new Error(
      `${path} does not declare a name, an author and a client.url`,
    );
  }
  return { name, author, client: { url } };
}

const EXPECTATIONS = ["loaded", "hash-blind", "unannounced"] as const;
type Expectation = (typeof EXPECTATIONS)[number];
const expectation: Expectation = (() => {
  const asked = need("GONOGO_SCAFFOLD_PROBE_EXPECT");
  const known = EXPECTATIONS.find((candidate) => candidate === asked);
  if (!known) {
    throw new Error(
      `GONOGO_SCAFFOLD_PROBE_EXPECT is "${asked}", not one of ${EXPECTATIONS.join(", ")}`,
    );
  }
  return known;
})();

const port = Number(need("GONOGO_SCAFFOLD_PROBE_PORT"));
const id = need("GONOGO_SCAFFOLD_PROBE_ID");
const bundlePath = need("GONOGO_SCAFFOLD_PROBE_BUNDLE");
const sidecarPath = need("GONOGO_SCAFFOLD_PROBE_SIDECAR");
const declared = readDeclaration(need("GONOGO_SCAFFOLD_PROBE_DECLARATION"));
const widgetId = `${id}-heartbeat`;

// Inside the package, so the bundle's bare imports resolve to the app's own copies as the import map makes them do in a browser.
const scratch = join(import.meta.dirname, "../../.scaffold-probe");

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(scratch, { recursive: true, force: true });
});

const registered = () => getComponents().map((component) => component.id);

/**
 * The `ws` socket behind the shape the transport asks for, because under jsdom
 * neither global one can reach a real stream: the test setup's connects to
 * nothing, and Node's own throws on its first event. Each frame is handed on as
 * a byte view, which the transport recognises whichever realm made it.
 */
class StreamSocket implements WebSocketLike {
  static readonly OPEN = NodeWebSocket.OPEN;
  private readonly socket: NodeWebSocket;

  constructor(url: string) {
    this.socket = new NodeWebSocket(url);
  }

  get readyState(): number {
    return this.socket.readyState;
  }

  send(data: string): void {
    this.socket.send(data);
  }

  close(code?: number, reason?: string): void {
    this.socket.close(code, reason);
  }

  addEventListener(
    type: "open" | "close" | "error" | "message",
    listener: (event: { data: unknown }) => void,
  ): void {
    if (type !== "message") {
      this.socket.on(type, () => listener({ data: undefined }));
      return;
    }
    this.socket.on("message", (data) => {
      if (Array.isArray(data)) {
        listener({ data: Buffer.concat(data) });
        return;
      }
      listener({ data: data instanceof Buffer ? data : new Uint8Array(data) });
    });
  }
}

async function boot() {
  const roster = await probeUplinkRoster({
    transport: new WebSocketTransport({
      host: "127.0.0.1",
      port,
      WebSocketImpl: StreamSocket,
    }),
    timeoutMs: 20_000,
  });
  // The app ships no index entry for an outside Uplink, so the roster is all that can name it.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ uplinks: [] })),
  );
  const consents: ConsentInfo[] = [];
  const fetched: string[] = [];
  const outcomes = await loadEnabledUplinks({
    registrySource: { url: "/uplinks/registry.local.json" },
    // The build stamps the contract version into the app, and there is no build here, so it is read from where the build reads it.
    hostCompat: {
      ...hostCompat,
      contractMajor: CONTRACT_MAJOR,
      contractMinor: CONTRACT_MINOR,
    },
    appVersion: "999.0.0",
    roster,
    ensureConsent: async (info) => {
      consents.push(info);
      return true;
    },
    fetchManifest: async (url) => {
      fetched.push(url);
      return JSON.parse(readFileSync(sidecarPath, "utf8"));
    },
    fetchBytes: async (url) => {
      fetched.push(url);
      const bytes = readFileSync(bundlePath);
      return bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
    },
    importBundle: async (bytes) => {
      mkdirSync(scratch, { recursive: true });
      const file = join(scratch, `${id}.client.mjs`);
      writeFileSync(file, new Uint8Array(bytes));
      return import(/* @vite-ignore */ pathToFileURL(file).href);
    },
  });
  return { roster, outcomes, consents, fetched };
}

it.runIf(expectation === "loaded")(
  "a scaffolded Uplink's plugin announces its client, and the app loads it and draws its widget",
  async () => {
    const { roster, outcomes, consents, fetched } = await boot();

    const entry = roster?.find((candidate) => candidate.id === id);
    expect(entry, "the mod's roster names the scaffolded Uplink").toBeDefined();
    expect(entry?.clientSource).toEqual({
      url: declared.client.url,
      devPath: null,
    });
    expect(entry?.name).toBe(declared.name);
    expect(entry?.author).toBe(declared.author);
    expect(entry?.expectedClientHash).toMatch(/^sha256-[0-9a-f]{64}$/);

    expect(outcomes).toHaveLength(1);
    // Status and reason together, so a refusal prints why.
    expect(`${outcomes[0].status}: ${outcomes[0].reason}`).toMatch(/^loaded: /);
    expect(fetched).toEqual([
      manifestUrlFor(declared.client.url),
      declared.client.url,
    ]);
    // What the operator is asked about is what the plugin said, not what the bundle says of itself.
    expect(consents).toHaveLength(1);
    expect(consents[0].id).toBe(id);
    expect(consents[0].version).toBe(entry?.version);
    expect(consents[0].author).toBe(declared.author);

    expect(registered()).toContain(widgetId);
    const widget = getComponents().find(
      (component) => component.id === widgetId,
    );
    if (!widget) throw new Error("unreachable: asserted above");
    render(createElement(widget.component as () => JSX.Element));
    expect(
      screen.getByText(new RegExp(`waiting for the ${id} uplink`, "i")),
    ).toBeVisible();
  },
);

it.runIf(expectation === "hash-blind")(
  "a plugin baked without its bundle announces a client the app refuses",
  async () => {
    const { roster, outcomes, fetched } = await boot();

    const entry = roster?.find((candidate) => candidate.id === id);
    expect(entry?.clientSource?.url).toBe(declared.client.url);
    expect(entry?.expectedClientHash).toBeNull();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe("quarantined");
    expect(outcomes[0].reason).toMatch(/no mod-vouched client hash/);
    expect(fetched).toEqual([]);
    expect(registered()).not.toContain(widgetId);
  },
);

it.runIf(expectation === "unannounced")(
  "a plugin that announces no client is installed and the app attempts nothing",
  async () => {
    const { roster, outcomes, fetched } = await boot();

    const entry = roster?.find((candidate) => candidate.id === id);
    expect(entry, "the plugin is still on the roster").toBeDefined();
    expect(entry?.clientSource).toBeNull();
    expect(outcomes).toEqual([]);
    expect(fetched).toEqual([]);
    expect(registered()).not.toContain(widgetId);
  },
);
