import { describe, expect, it } from "vitest";
import type { BodyStatesRequest } from "../__generated__/contract";
import { PropagationCertification } from "../__generated__/contract";
import { createTestTelemetryClient } from "../testing/create-test-telemetry-client";
import { StubTransport } from "../testing/stub-transport";
import { isValue, value } from "../unit-system";
import { dehydrateArgs } from "../wrap-units";

/**
 * The command boundary in both directions, asserted on the WIRE rather than on
 * the object handed to the transport.
 *
 * `StubTransport.sentCommands` records the args by reference, so a `Value` in
 * them reads as a perfectly good `Value` there and every assertion passes while
 * the mod gets an object it refuses. What crosses is the JSON, so that is what
 * these round-trip: `Value.toJSON` is the whole defect, and it only shows up
 * once something stringifies.
 *
 * What the mod does with the un-dehydrated shape is not a guess.
 * `ChannelEngine.BindCommandArgs` rejects a dictionary in a numeric slot
 * outright (`Cannot bind wire value of type Dictionary'2 to numeric Double`),
 * the throw fail-softs the handler, and the command answers `null` having never
 * run. `Sitrep.Host.Tests/CommandArgBinderTests.cs` pins that half.
 */
function wireArgsOf(transport: StubTransport): Record<string, unknown> {
  return JSON.parse(JSON.stringify(transport.sentCommands[0].args));
}

/**
 * One field off a reply, without asserting the reply's type.
 *
 * `dispatch` resolves `unknown`, and an assertion out of `unknown` is what the
 * unknown-cast scan stops, so this narrows rather than asserting.
 */
function fieldOf(reply: unknown, field: string): unknown {
  if (reply === null || typeof reply !== "object") return undefined;
  return Reflect.get(reply, field);
}

describe("a typed command's args reach the wire as bare numbers", () => {
  it("dehydrates a scalar quantity by its declared unit", () => {
    // No core command's args carry a scalar quantity today, so the walk is asserted directly on a planted shape: a Value at a key, beside a plain field that must pass through untouched.
    const wire = JSON.parse(
      JSON.stringify(
        dehydrateArgs({
          topic: "planted.topic",
          toUt: value("ut", 2000),
          maxPoints: value("count", 128),
        }),
      ),
    );

    expect(wire).toEqual({
      topic: "planted.topic",
      toUt: 2000,
      maxPoints: 128,
    });
  });

  it("dehydrates a sequence of quantities element by element", async () => {
    const transport = new StubTransport();
    transport.setCommandHandler(() => ({ solved: true, states: [] }));
    const client = createTestTelemetryClient(transport);
    const request: BodyStatesRequest = {
      bodyIndex: 1,
      centreBodyIndex: 0,
      uts: [value("ut", 100), value("ut", 200)],
      certification: PropagationCertification.Unbounded,
    };

    await client.dispatch("system.bodies.statesAt", request).result;

    expect(wireArgsOf(transport).uts).toEqual([100, 200]);
  });

  it("leaves the caller's own args object alone", () => {
    // The args are a widget's state, not something off the transport, so the
    // dehydrate copies where the inbound wrap mutates. A dispatch that rewrote
    // a `Value` in a caller's state to a number would break whatever renders it
    // on the very next frame.
    const transport = new StubTransport();
    transport.setCommandHandler(() => ({ solved: true, states: [] }));
    const client = createTestTelemetryClient(transport);
    const request: BodyStatesRequest = {
      bodyIndex: 1,
      centreBodyIndex: 0,
      uts: [value("ut", 100)],
      certification: PropagationCertification.Unbounded,
    };

    client.dispatch("system.bodies.statesAt", request);

    expect(isValue(request.uts[0])).toBe(true);
  });
});

describe("a command reply's declared quantities arrive as Values", () => {
  it("wraps by the command's Result type", async () => {
    const transport = new StubTransport();
    transport.setCommandHandler(() => ({
      solved: true,
      states: [{ ut: 4242, x: 1, y: 2, z: 3, vx: 0, vy: 0, vz: 0 }],
    }));
    const client = createTestTelemetryClient(transport);

    const reply = await client.dispatch("system.bodies.statesAt", {
      bodyIndex: 1,
      centreBodyIndex: 0,
      uts: [],
      certification: PropagationCertification.Unbounded,
    }).result;

    const states = fieldOf(reply, "states");
    const first = Array.isArray(states) ? states[0] : undefined;
    const ut = fieldOf(first, "ut");
    expect(isValue(ut)).toBe(true);
    expect(ut).toMatchObject({ magnitude: 4242, unit: "ut" });
  });

  it("leaves a reply with no declared quantity untouched", async () => {
    const transport = new StubTransport();
    transport.setCommandHandler(() => ({ success: true, detail: "" }));
    const client = createTestTelemetryClient(transport);

    const reply = await client.dispatch("vessel.control.setSas", {
      enabled: true,
    }).result;

    expect(reply).toEqual({ success: true, detail: "" });
  });
});
