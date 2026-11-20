import { TelemetryClient, TelemetryProvider } from "@ksp-gonogo/sitrep-client";
import { makeMeta, StubTransport } from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bodyTextureTopic, useBodyTextureUrl } from "./useBodyTexture";

function MapProbe({ body }: { body: string | undefined }) {
  const url = useBodyTextureUrl(body);
  return <div>{url === undefined ? "map:waiting" : `map:${url}`}</div>;
}

function sendMap(t: StubTransport, body: string, segments: Uint8Array[]) {
  act(() =>
    t.emitRaw({
      type: "stream-binary",
      topic: bodyTextureTopic(body),
      segments,
      meta: makeMeta(),
    }),
  );
}

describe("bodyTextureTopic", () => {
  it("writes a body's name as one topic segment, as the mod does", () => {
    expect(bodyTextureTopic("Kerbin")).toBe("bodies.texture.Kerbin");
    expect(bodyTextureTopic("Gael's Moon")).toBe(
      "bodies.texture.Gael%27s%20Moon",
    );
    expect(bodyTextureTopic("Ève")).toBe("bodies.texture.%C3%88ve");
  });
});

describe("useBodyTextureUrl", () => {
  let made: Blob[];
  beforeEach(() => {
    made = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      made.push(blob as Blob);
      return `blob:map-${made.length}`;
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("opens the body's own topic and serves the map the mod sends as a PNG", () => {
    const t = new StubTransport();
    render(
      <TelemetryProvider client={new TelemetryClient(t)}>
        <MapProbe body="Duna" />
      </TelemetryProvider>,
    );
    expect(screen.getByText("map:waiting")).toBeTruthy();
    expect(t.isSubscribed("bodies.texture.Duna")).toBe(true);

    sendMap(t, "Duna", [new Uint8Array([0x89, 0x50, 0x4e, 0x47])]);

    expect(screen.getByText("map:blob:map-1")).toBeTruthy();
    expect(made[0].type).toBe("image/png");
    expect(made[0].size).toBe(4);
  });

  it("answers null when the mod says the game has no map for the body", () => {
    const t = new StubTransport();
    render(
      <TelemetryProvider client={new TelemetryClient(t)}>
        <MapProbe body="Sun" />
      </TelemetryProvider>,
    );

    sendMap(t, "Sun", []);

    expect(screen.getByText("map:null")).toBeTruthy();
    expect(made).toHaveLength(0);
  });

  it("asks for nothing with no body", () => {
    const t = new StubTransport();
    render(
      <TelemetryProvider client={new TelemetryClient(t)}>
        <MapProbe body={undefined} />
      </TelemetryProvider>,
    );
    expect(screen.getByText("map:waiting")).toBeTruthy();
    expect(t.isSubscribed("bodies.texture.")).toBe(false);
    expect(t.isSubscribed("")).toBe(false);
  });
});
