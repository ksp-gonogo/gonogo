import { bodyTextureTopic, useBodyTextureUrl } from "@ksp-gonogo/data";
import { render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { ws } from "msw";
import { setupServer } from "msw/node";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { SitrepTelemetryProvider } from "../telemetry/SitrepTelemetryProvider";
import type { LinkClient } from "../test/peerFakes";

/**
 * A body's surface map as the mod serves it: the real provider and transport
 * subscribe `bodies.texture.<body>`, and a binary-lane frame on the socket
 * becomes the PNG a map draws, or nothing at all when the mod says the body
 * has no map. Only the socket is mocked.
 */

const link = ws.link("ws://localhost:8090");
const server = setupServer();

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** A binary-lane frame as the mod writes it: magic, lane, header length, JSON header, then the segments. */
function binaryFrame(topic: string, segments: Uint8Array[]): Uint8Array {
  const header = new TextEncoder().encode(
    JSON.stringify({
      type: "stream-binary",
      topic,
      segments: segments.map((s) => s.byteLength),
      meta: {
        source: "system",
        validAt: 1,
        seq: 1,
        deliveredAt: 1,
        vantage: "test",
        active: true,
        staleness: 0,
        timelineEpoch: 0,
      },
    }),
  );
  const total = segments.reduce((n, s) => n + s.byteLength, 0);
  const frame = new Uint8Array(4 + header.byteLength + total);
  frame.set([0x9e, 0x01, header.byteLength >> 8, header.byteLength & 0xff]);
  frame.set(header, 4);
  let at = 4 + header.byteLength;
  for (const s of segments) {
    frame.set(s, at);
    at += s.byteLength;
  }
  return frame;
}

function MapProbe({ body }: { body: string }) {
  const url = useBodyTextureUrl(body);
  return <div>{url === undefined ? "map:waiting" : `map:${url}`}</div>;
}

/** The topic a client message subscribes, or undefined when it is not a subscribe. */
function subscribedTopic(message: unknown): string | undefined {
  if (typeof message !== "object" || message === null) return undefined;
  if (!("type" in message) || message.type !== "subscribe") return undefined;
  return "topic" in message && typeof message.topic === "string"
    ? message.topic
    : undefined;
}

/** Each connection the app opens, with every topic it has subscribed on it so far. */
function connections(): { client: LinkClient; subscribed: string[] }[] {
  const opened: { client: LinkClient; subscribed: string[] }[] = [];
  server.use(
    link.addEventListener("connection", ({ client }) => {
      const connection = { client, subscribed: [] as string[] };
      opened.push(connection);
      client.addEventListener("message", (event) => {
        if (typeof event.data !== "string") return;
        const topic = subscribedTopic(JSON.parse(event.data));
        if (topic) {
          connection.subscribed.push(topic);
        }
      });
    }),
  );
  return opened;
}

describe("a body's map over the Sitrep stream", () => {
  let blobs: Blob[];
  beforeEach(() => {
    blobs = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return `blob:${blobs.length}`;
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("subscribes the body's topic and serves the PNG the mod sends", async () => {
    const opened = connections();
    render(
      <SitrepTelemetryProvider enabled host="localhost" port={8090}>
        <MapProbe body="Mun" />
      </SitrepTelemetryProvider>,
    );
    expect(await screen.findByText("map:waiting")).toBeTruthy();
    await waitFor(() =>
      expect(opened[0]?.subscribed).toContain(bodyTextureTopic("Mun")),
    );

    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    opened[0].client.send(binaryFrame(bodyTextureTopic("Mun"), [png]));

    expect(await screen.findByText("map:blob:1")).toBeTruthy();
    expect(blobs[0].type).toBe("image/png");
    expect(new Uint8Array(await blobs[0].arrayBuffer())).toEqual(png);
  });

  it("serves no map when the mod says the body has none", async () => {
    const opened = connections();
    render(
      <SitrepTelemetryProvider enabled host="localhost" port={8090}>
        <MapProbe body="Sun" />
      </SitrepTelemetryProvider>,
    );
    await waitFor(() =>
      expect(opened[0]?.subscribed).toContain(bodyTextureTopic("Sun")),
    );

    opened[0].client.send(binaryFrame(bodyTextureTopic("Sun"), []));

    expect(await screen.findByText("map:null")).toBeTruthy();
    expect(blobs).toHaveLength(0);
  });
});
