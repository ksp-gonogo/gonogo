import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CommsPath, Reading } from "@ksp-gonogo/sitrep-sdk";
import { useTelemetry } from "@ksp-gonogo/sitrep-sdk";
import {
  renderHook,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { REALANTENNAS_PROVIDER_ID, readRealAntennasHopExt } from "./hopExt";

/**
 * The payload a reading carries, or `undefined`. `useTelemetry` answers with a
 * `Reading`, which is ALWAYS defined, so a `waitFor` on the reading itself
 * passes on the first tick and every hydration assertion below then reads
 * `undefined` off the wrapper.
 */
function judgeable<T>(reading: Reading<T>): T | undefined {
  if (reading.reckoning === "available") return reading.reckoned.value;
  if (reading.state === "observed") return reading.value;
  return undefined;
}

// src -> client -> GonogoRealAntennasUplink -> mod
const MOD_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const FIXTURE = join(MOD_ROOT, "golden-fixtures", "commshop-extensions.json");
const COMMS_PATH_TOPIC = "comms.path";

/**
 * The frame the SERVER actually produced, read off disk. `CommsHopExtensionWireTests`
 * (this Uplink's dotnet tests) asserts the real codec equals this file byte for
 * byte, so it is the wire frame, not a hand-authored approximation, and the two
 * halves cannot drift without one going red.
 */
function serverFrame(): { topic: string; payload: CommsPath } {
  const vectors = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
    name: string;
    json: string;
  }[];
  const vector = vectors.find((v) => v.name === "path-with-realantennas-hop");
  if (vector === undefined) {
    throw new Error("fixture vector path-with-realantennas-hop not found");
  }
  return JSON.parse(vector.json) as { topic: string; payload: CommsPath };
}

describe("realantennas' namespace of CommsHop's provider extension bag", () => {
  it("is written under the same provider id the C# backend registers with", () => {
    const src = readFileSync(
      join(MOD_ROOT, "GonogoRealAntennasUplink", "RaCommsBackend.cs"),
      "utf8",
    );
    const m = src.match(/const\s+string\s+Id\s*=\s*"([^"]+)"/);
    expect(m?.[1]).toBe(REALANTENNAS_PROVIDER_ID);

    const frame = serverFrame();
    expect(frame.topic).toBe(COMMS_PATH_TOPIC);
    expect(Object.keys(frame.payload.hops[0]?.extensions ?? {})).toContain(
      REALANTENNAS_PROVIDER_ID,
    );
  });

  it("narrows to the RA typed shape, and leaves an unknown provider alone", () => {
    const ext = readRealAntennasHopExt(serverFrame().payload.hops[0]);
    expect(ext).toBeDefined();
    expect(ext?.band).toBe("X");
    expect(ext?.encoder).toBe("Reed-Solomon 255/223");

    expect(
      readRealAntennasHopExt({
        extensions: { someprovider: { x: 1 } },
      } as never),
    ).toBeUndefined();
    expect(readRealAntennasHopExt({} as never)).toBeUndefined();
    expect(readRealAntennasHopExt(undefined)).toBeUndefined();
  });

  // The end-to-end assertion the mechanism exists for: the RA namespace hangs off a
  // NESTED CommsHop inside comms.path, so wrapTopicPayload can only reach it by
  // walking comms.path -> hops[] -> CommsHop -> extensions.realantennas. That last
  // hop works only because ./hopExt.ts registered the shape
  // (registerProviderExtensionShape keyed on the CommsHop type) and ./topics.ts fed
  // the generated TYPE units in. Delete either and the quantities below arrive bare.
  it("hydrates the namespace's quantities at decode time, off the real frame", async () => {
    const frame = serverFrame();
    const fixture = setupStreamFixture({ carriedChannels: [COMMS_PATH_TOPIC] });
    const { result } = renderHook(
      () => judgeable(useTelemetry(COMMS_PATH_TOPIC)),
      { wrapper: fixture.Provider },
    );

    fixture.emit(COMMS_PATH_TOPIC, frame.payload);

    await waitFor(() => {
      expect(result.current?.hops[0]?.extensions).toBeDefined();
    });

    const ext = readRealAntennasHopExt(result.current?.hops[0]);
    // A bare number fails these (no `.magnitude`/`.unit` own properties).
    expect(ext?.requiredEbN0).toMatchObject({ magnitude: 6.1, unit: "dB" });
    expect(ext?.reverseBitsPerSec).toMatchObject({
      magnitude: 9600,
      unit: "bit/s",
    });
    expect(ext?.beamwidth).toMatchObject({ magnitude: 12.5, unit: "°" });
    expect(ext?.techLevel).toMatchObject({ magnitude: 7, unit: "count" });
    // A non-quantity token stays bare, the contrast that ties wrapping to the TOKEN.
    expect(ext?.band).toBe("X");
    expect(ext?.encoder).toBe("Reed-Solomon 255/223");
  });

  it("leaves the shared hop fields exactly as the wire sent them", async () => {
    const frame = serverFrame();
    const fixture = setupStreamFixture({ carriedChannels: [COMMS_PATH_TOPIC] });
    const { result } = renderHook(
      () => judgeable(useTelemetry(COMMS_PATH_TOPIC)),
      { wrapper: fixture.Provider },
    );

    fixture.emit(COMMS_PATH_TOPIC, frame.payload);

    await waitFor(() => {
      expect(result.current?.hops[0]).toBeDefined();
    });

    const hop = result.current?.hops[0];
    expect(hop?.from).toBe("vessel");
    expect(hop?.to).toBe("home");
    // The shared hop no longer carries a forward rate: it left for the RA
    // uplink's own realantennas.hopRates channel (Major 13), so the shared shape
    // stays RA-agnostic and this key is simply absent.
    expect(
      (hop as unknown as { bandRateBitsPerSec?: unknown }).bandRateBitsPerSec,
    ).toBeUndefined();
  });
});
