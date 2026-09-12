import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getAllKnownCommandIds,
  getAllKnownTopicIds,
  isCommandId,
  isTopicId,
  useTelemetry,
} from "@ksp-gonogo/sitrep-sdk";
import {
  renderHook,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
// Side-effect imports: register the chain Topic and its command into the SDK's
// runtime registries.
import { UPLINK_COMMAND_IDS } from "./commands";
import { REALANTENNAS_CHAINS_TOPIC } from "./topics";

// src -> client -> GonogoRealAntennasUplink
const UPLINK_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function csConst(constName: string): string {
  const src = readFileSync(join(UPLINK_ROOT, "RealAntennasUplink.cs"), "utf8");
  const m = src.match(
    new RegExp(`const\\s+string\\s+${constName}\\s*=\\s*"([^"]+)"`),
  );
  if (!m) {
    throw new Error(`${constName} constant not found in RealAntennasUplink.cs`);
  }
  return m[1];
}

describe("the realantennas.antennaChains channel", () => {
  it("registers the same string the C# Uplink declares", () => {
    expect(REALANTENNAS_CHAINS_TOPIC).toBe(csConst("ChainsTopic"));
  });

  it("is a known TopicId once this client's topics module has loaded", () => {
    expect(isTopicId(REALANTENNAS_CHAINS_TOPIC)).toBe(true);
    expect(getAllKnownTopicIds()).toContain(REALANTENNAS_CHAINS_TOPIC);
  });

  /**
   * Driven through the real decode path because this is the first NESTED payload
   * this Uplink publishes: each chain carries its own array of entries, and the
   * hydration has to reach inside it. A client that got bare numbers there would
   * render an aim point with no units rather than fail, which is exactly the
   * kind of regression that survives a typecheck.
   */
  it("decodes as an array of chains, with the nested entries hydrated", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [REALANTENNAS_CHAINS_TOPIC],
    });
    const { result } = renderHook(
      () => {
        const reading = useTelemetry(REALANTENNAS_CHAINS_TOPIC);
        return reading.state === "observed" ? reading.value : undefined;
      },
      { wrapper: fixture.Provider },
    );

    fixture.emit(REALANTENNAS_CHAINS_TOPIC, [
      {
        antennaId: "4021/0",
        steps: [
          { mode: "BodyCenter" },
          {
            mode: "BodyLatLonAlt",
            bodyName: "Mun",
            latitude: -0.5,
            longitude: 121.25,
            altitude: 1500,
          },
        ],
        activeStep: 1,
        state: "settling",
        detail: "Waiting to see whether the target in place gives a link.",
        settleSeconds: 30,
        lastAppliedUt: 9001.5,
        laps: 2,
        connected: false,
        carrying: false,
        meta: { source: "vessel:1", quality: 2 },
      },
    ]);

    await waitFor(() => expect(result.current).toBeDefined());
    const chains = result.current ?? [];
    expect(chains).toHaveLength(1);
    expect(chains[0].antennaId).toBe("4021/0");
    expect(chains[0].steps).toHaveLength(2);
    expect(chains[0].steps[1].latitude?.magnitude).toBe(-0.5);
    expect(chains[0].steps[1].latitude?.unit).toBe("°");
    expect(chains[0].steps[1].altitude?.unit).toBe("m");
    expect(chains[0].settleSeconds.magnitude).toBe(30);
    expect(chains[0].settleSeconds.unit).toBe("s");
    expect(chains[0].activeStep?.magnitude).toBe(1);
    expect(chains[0].laps.magnitude).toBe(2);
  });

  /**
   * An empty array is a real value: the craft holds no chain. It has to reach
   * the client as such rather than as absence, because the channel is
   * LossyLatest and the previous craft's chains would otherwise stand.
   */
  it("decodes an empty array as an observed value rather than absence", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [REALANTENNAS_CHAINS_TOPIC],
    });
    const { result } = renderHook(
      () => useTelemetry(REALANTENNAS_CHAINS_TOPIC).state,
      { wrapper: fixture.Provider },
    );

    fixture.emit(REALANTENNAS_CHAINS_TOPIC, []);

    await waitFor(() => expect(result.current).toBe("observed"));
  });

  /**
   * The three fields that carry three answers each survive the decode as null
   * rather than collapsing. The craft's own walk refuses to move on the third
   * answer, so a client must be able to tell it apart: an unread link is not a
   * lost one, and a walk that has never started is not a walk on its first
   * entry.
   */
  it("keeps an unstarted walk and an unread link distinguishable from zero and false", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [REALANTENNAS_CHAINS_TOPIC],
    });
    const { result } = renderHook(
      () => {
        const reading = useTelemetry(REALANTENNAS_CHAINS_TOPIC);
        return reading.state === "observed" ? reading.value : undefined;
      },
      { wrapper: fixture.Provider },
    );

    fixture.emit(REALANTENNAS_CHAINS_TOPIC, [
      {
        antennaId: "4021/0",
        steps: [{ mode: "BodyCenter" }],
        activeStep: null,
        state: "blocked",
        detail: "The craft would not say whether it has a link.",
        settleSeconds: 30,
        lastAppliedUt: null,
        laps: 0,
        connected: null,
        carrying: null,
        meta: { source: "vessel:1", quality: 2 },
      },
    ]);

    await waitFor(() => expect(result.current).toBeDefined());
    const chain = (result.current ?? [])[0];
    expect(chain.activeStep ?? null).toBeNull();
    expect(chain.lastAppliedUt ?? null).toBeNull();
    expect(chain.connected ?? null).toBeNull();
    expect(chain.carrying ?? null).toBeNull();
  });
});

describe("the realantennas.antenna.targetChain command", () => {
  it("registers the same string the C# Uplink declares", () => {
    expect(UPLINK_COMMAND_IDS).toContain(csConst("TargetChainCommand"));
  });

  it("is a known CommandId once this client's commands module has loaded", () => {
    const command = csConst("TargetChainCommand");
    expect(isCommandId(command)).toBe(true);
    expect(getAllKnownCommandIds()).toContain(command);
  });

  /**
   * DELAYED, and this is the one command in the Uplink whose whole value comes
   * from that: the chain rides light-time once and the craft then re-aims itself
   * with no delay at all. A rail that lost its delay would put the operator back
   * to flying the fallback by hand from the ground, which is the thing that
   * cannot be done at the moment it is needed.
   */
  it("carries a delayed rail, like the two single-target commands", async () => {
    const { GENERATED_COMMAND_RAIL } = await import(
      "./__generated__/command-map"
    );
    // Indexed by the literal, with the C# checked against it on the line below,
    // because the generated map is a closed record and the constant read out of
    // a file is a `string`. Asserting the two agree keeps the literal honest.
    const rail = GENERATED_COMMAND_RAIL["realantennas.antenna.targetChain"];

    expect("realantennas.antenna.targetChain").toBe(
      csConst("TargetChainCommand"),
    );
    expect(rail.delayed).toBe(true);
    expect(rail.replies).toBe(true);
  });
});
