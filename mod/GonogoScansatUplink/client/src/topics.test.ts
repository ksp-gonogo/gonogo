import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAllKnownTopicIds, isTopicId } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
// Side-effect import: registers `scansat.available` into the SDK's runtime registry.
import { SCANSAT_AVAILABLE_TOPIC } from "./topics";

// src -> client -> GonogoScansatUplink
const UPLINK_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The value of `ScansatUplink.AvailableTopic` as declared in the C# source. */
function csAvailableTopic(): string {
  const src = readFileSync(join(UPLINK_ROOT, "ScansatUplink.cs"), "utf8");
  const m = src.match(/const\s+string\s+AvailableTopic\s*=\s*"([^"]+)"/);
  if (!m)
    throw new Error("AvailableTopic constant not found in ScansatUplink.cs");
  return m[1];
}

describe("scansat.available bare-primitive Topic", () => {
  it("registers the same string the C# Uplink declares", () => {
    expect(SCANSAT_AVAILABLE_TOPIC).toBe(csAvailableTopic());
  });

  it("is a known TopicId once this client's topics module has loaded", () => {
    expect(isTopicId(SCANSAT_AVAILABLE_TOPIC)).toBe(true);
    expect(getAllKnownTopicIds()).toContain(SCANSAT_AVAILABLE_TOPIC);
  });
});
