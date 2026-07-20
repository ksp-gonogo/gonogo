import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAllKnownTopicIds, isTopicId } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
// Side-effect import: registers `kerbcast.available` into the SDK's runtime registry.
import { KERBCAST_AVAILABLE_TOPIC } from "./topics";

// src -> client -> GonogoKerbcastUplink
const UPLINK_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The value of `KerbcastUplink.AvailableTopic` as declared in the C# source. */
function csAvailableTopic(): string {
  const src = readFileSync(join(UPLINK_ROOT, "KerbcastUplink.cs"), "utf8");
  const m = src.match(/const\s+string\s+AvailableTopic\s*=\s*"([^"]+)"/);
  if (!m)
    throw new Error("AvailableTopic constant not found in KerbcastUplink.cs");
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
