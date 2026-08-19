import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Reading } from "@ksp-gonogo/sitrep-sdk";
import {
  getAllKnownTopicIds,
  isTopicId,
  useTelemetry,
} from "@ksp-gonogo/sitrep-sdk";
import { renderHook, waitFor } from "@ksp-gonogo/sitrep-sdk/testing";
import { setupStreamFixture } from "@ksp-gonogo/sitrep-testing";
import { describe, expect, it } from "vitest";
// Side-effect import: registers `kerbcast.available`/`kerbcast.cameras` into
// the SDK's runtime registry.
import { KERBCAST_AVAILABLE_TOPIC, KERBCAST_CAMERAS_TOPIC } from "./topics";

// src -> client -> GonogoKerbcastUplink
const UPLINK_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The value of `KerbcastUplink.AvailableTopic` as declared in the C# source. */
/**
 * The value a VERDICT may be drawn from: current, or modelled forward to the frame.
 * A stale reading gives nothing, because a judgement cannot be dated: the operator
 * reads a band or a pill as the situation NOW.
 */
function judgeable<T>(reading: Reading<T>): T | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "reckonable") return reading.reckoned.value;
  return undefined;
}

function csAvailableTopic(): string {
  const src = readFileSync(join(UPLINK_ROOT, "KerbcastUplink.cs"), "utf8");
  const m = src.match(/const\s+string\s+AvailableTopic\s*=\s*"([^"]+)"/);
  if (!m)
    throw new Error("AvailableTopic constant not found in KerbcastUplink.cs");
  return m[1];
}

/** The value of `KerbcastUplink.CamerasTopic` as declared in the C# source. */
function csCamerasTopic(): string {
  const src = readFileSync(join(UPLINK_ROOT, "KerbcastUplink.cs"), "utf8");
  const m = src.match(/const\s+string\s+CamerasTopic\s*=\s*"([^"]+)"/);
  if (!m)
    throw new Error("CamerasTopic constant not found in KerbcastUplink.cs");
  return m[1];
}

describe("kerbcast.available bare-primitive Topic", () => {
  it("registers the same string the C# Uplink declares", () => {
    expect(KERBCAST_AVAILABLE_TOPIC).toBe(csAvailableTopic());
  });

  it("is a known TopicId once this client's topics module has loaded", () => {
    expect(isTopicId(KERBCAST_AVAILABLE_TOPIC)).toBe(true);
    expect(getAllKnownTopicIds()).toContain(KERBCAST_AVAILABLE_TOPIC);
  });
});

describe("kerbcast.cameras Topic (relocated out of Sitrep.Contract)", () => {
  it("registers the same string the C# Uplink declares", () => {
    expect(KERBCAST_CAMERAS_TOPIC).toBe(csCamerasTopic());
  });

  it("is a known TopicId once this client's topics module has loaded", () => {
    expect(isTopicId(KERBCAST_CAMERAS_TOPIC)).toBe(true);
    expect(getAllKnownTopicIds()).toContain(KERBCAST_CAMERAS_TOPIC);
  });

  // The runtime-hydration half of the uplink-types-out-of-core plan's Unit
  // guard (§5b): a widget/decode test, not just the generated-file type
  // check. Drives the REAL TelemetryClient/StubTransport pipeline
  // (setupStreamFixture), so this proves registerTopicUnits (topics.ts)
  // actually reaches wrapTopicPayload's decode-time lookup. Without that
  // call, fieldOfView/panYaw/panPitch (and their min/max pairs) would arrive
  // as bare numbers here even though ../__generated__/contract.ts still
  // types them Value<"deg">: see AvionicsRtConfig.Configure's/topics.ts's
  // doc comments for the exact gap this closes.
  it('hydrates fieldOfView into a Value<"°"> at decode time, not a bare number', async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [KERBCAST_CAMERAS_TOPIC],
    });
    const { result } = renderHook(
      () => judgeable(useTelemetry(KERBCAST_CAMERAS_TOPIC)),
      {
        wrapper: fixture.Provider,
      },
    );

    fixture.emit(KERBCAST_CAMERAS_TOPIC, [
      { cameraId: 7, fieldOfView: 45, panYaw: 12.5 },
    ]);

    await waitFor(() => {
      expect(result.current?.[0]?.fieldOfView).toBeDefined();
    });

    const camera = result.current?.[0];
    // A plain number would fail both assertions below (no `.magnitude`/`.unit`
    // own properties): this is the non-vacuous proof the field actually
    // decoded through wrapTopicPayload rather than passing through bare.
    expect(camera?.fieldOfView).toMatchObject({ magnitude: 45, unit: "°" });
    expect(camera?.panYaw).toMatchObject({ magnitude: 12.5, unit: "°" });
    // cameraId is Units.Id (a non-quantity token): stays a bare number, never
    // wrapped, the same contrast AvionicsStatus's Flag fields drew.
    expect(camera?.cameraId).toBe(7);
  });
});
