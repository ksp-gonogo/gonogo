import { PropagationCertification } from "@ksp-gonogo/sitrep-sdk";
import { render, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import type { PorkchopAxes } from "./transferData";
import {
  type BodyRef,
  type BodyStatePropagators,
  useBodyStatePropagators,
} from "./useBodyStatePropagators";

const BODY_STATES = "system.bodies.statesAt";

const sun: BodyRef = { index: 0, name: "Sun", referenceBody: null };
const earth: BodyRef = { index: 1, name: "Earth", referenceBody: "Sun" };
const mars: BodyRef = { index: 2, name: "Mars", referenceBody: "Sun" };
const moon: BodyRef = { index: 3, name: "Moon", referenceBody: "Earth" };
const bodies = [sun, earth, mars, moon];

interface Asked {
  bodyIndex: number;
  uts: number[];
}

/**
 * What the hook must have sent, narrowed rather than asserted.
 *
 * A handler that assumed the shape would answer a malformed request as
 * readily as a good one, and the test would then be pinning the reply path
 * against a request nobody checked.
 */
function asked(args: unknown): Asked {
  if (
    typeof args === "object" &&
    args !== null &&
    "bodyIndex" in args &&
    typeof args.bodyIndex === "number" &&
    "uts" in args &&
    Array.isArray(args.uts)
  ) {
    return { bodyIndex: args.bodyIndex, uts: args.uts };
  }
  throw new Error(
    `expected a body and a list of instants, got ${JSON.stringify(args)}`,
  );
}

const axes: PorkchopAxes = {
  departureUts: [0, 100, 200],
  arrivalUts: [1000, 1100, 1200],
  muParent: 1.327e20,
};

/** A reply in WIRE form: bare numbers, which is what a command response carries. */
function reply(uts: number[], scale: number) {
  return {
    solved: true,
    providerId: "test",
    states: uts.map((ut) => ({
      ut,
      x: ut * scale,
      y: 0,
      z: 0,
      vx: 0,
      vy: scale,
      vz: 0,
    })),
  };
}

function renderProbe(
  fixture: ReturnType<typeof setupStreamFixture>,
  input: PorkchopAxes | null,
) {
  const seen: { current: BodyStatePropagators | null } = { current: null };
  function Probe() {
    seen.current = useBodyStatePropagators(earth, mars, bodies, input);
    return null;
  }
  render(
    <fixture.Provider>
      <Probe />
    </fixture.Provider>,
  );
  return seen;
}

describe("useBodyStatePropagators: the porkchop asks the game where the bodies are", () => {
  it("batches one dispatch per body, whole axis, about the parent they share", async () => {
    const fixture = setupStreamFixture({ carriedChannels: [BODY_STATES] });
    fixture.transport.setCommandHandler((_command, args) =>
      reply(asked(args).uts, 1),
    );

    renderProbe(fixture, axes);

    await waitFor(() => {
      expect(fixture.transport.sentCommands).toHaveLength(2);
    });
    const sent = fixture.transport.sentCommands.map((c) => c.args);
    /*
     * Two commands for six instants, not six: the batch is the whole reason a
     * 32x32 grid is 64 solves rather than 64 round trips. And the bound it
     * will accept is on the request rather than left to a default, so a grid
     * cannot keep drawing the same plot right up until that default moves and
     * then draw a different transfer without saying so.
     */
    expect(sent).toEqual([
      {
        bodyIndex: 1,
        centreBodyIndex: 0,
        uts: [0, 100, 200],
        certification: PropagationCertification.Unbounded,
      },
      {
        bodyIndex: 2,
        centreBodyIndex: 0,
        uts: [1000, 1100, 1200],
        certification: PropagationCertification.Unbounded,
      },
    ]);
  });

  it("answers with the states the provider gave, keyed by the instants asked", async () => {
    const fixture = setupStreamFixture({ carriedChannels: [BODY_STATES] });
    fixture.transport.setCommandHandler((_command, args) => {
      const { uts, bodyIndex } = asked(args);
      return reply(uts, bodyIndex);
    });

    const seen = renderProbe(fixture, axes);

    await waitFor(() => {
      expect(seen.current).not.toBeNull();
    });
    expect(seen.current?.propagateOrigin(100).position).toEqual([100, 0, 0]);
    expect(seen.current?.propagateDest(1100).position).toEqual([2200, 0, 0]);
  });

  it("declines entirely when a reply does not cover the instants asked", async () => {
    const fixture = setupStreamFixture({ carriedChannels: [BODY_STATES] });
    fixture.transport.setCommandHandler((_command, args) => {
      const { uts, bodyIndex } = asked(args);
      // The destination comes back one state short. A half-provider,
      // half-local grid would put a seam through the middle of a Δv surface,
      // so the caller must get nothing and fall back whole.
      return reply(bodyIndex === 2 ? uts.slice(1) : uts, bodyIndex);
    });

    const seen = renderProbe(fixture, axes);

    await waitFor(() => {
      expect(fixture.transport.sentCommands).toHaveLength(2);
    });
    expect(seen.current).toBeNull();
  });

  it("asks nothing at all when the two bodies do not share a parent", async () => {
    const fixture = setupStreamFixture({ carriedChannels: [BODY_STATES] });
    fixture.transport.setCommandHandler(() => reply(axes.departureUts, 1));

    const seen: { current: BodyStatePropagators | null } = { current: null };
    function Probe() {
      /*
       * Earth orbits the Sun and the Moon orbits Earth: there is no frame one
       * request can express both in, and a centre picked anyway would be a
       * silently wrong answer rather than a missing one.
       */
      seen.current = useBodyStatePropagators(earth, moon, bodies, axes);
      return null;
    }
    render(
      <fixture.Provider>
        <Probe />
      </fixture.Provider>,
    );

    await waitFor(() => {
      expect(seen.current).toBeNull();
    });
    expect(fixture.transport.sentCommands).toHaveLength(0);
  });
});
