// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { type OrbitPatch, TransitionType } from "../__generated__/contract";
import { render } from "../testing";
import { type WireOf, wrapTypePayload } from "../wrap-units";
import { deriveCelestialFacts } from "./celestial-facts";
import type { PatchChain } from "./patch-chain";
import { type UsePatchChainInput, usePatchChain } from "./use-patch-chain";

const MUN_SMA = 12_000_000;

const FACTS = deriveCelestialFacts([
  {
    index: 0,
    name: "Kerbin",
    parentIndex: undefined,
    gravParameter: { magnitude: 3.5316e12 },
  },
  {
    index: 1,
    name: "Mun",
    parentIndex: 0,
    gravParameter: { magnitude: 6.5138398e10 },
    orbit: {
      sma: { magnitude: MUN_SMA },
      ecc: { magnitude: 0 },
      inc: { magnitude: 0 },
      lan: { magnitude: 0 },
      argPe: { magnitude: 0 },
      meanAnomalyAtEpoch: { magnitude: 0 },
      epoch: { magnitude: 0 },
    },
  },
] as never);

function patch(overrides: Partial<WireOf<OrbitPatch>> = {}): OrbitPatch {
  return wrapTypePayload<OrbitPatch>("OrbitPatch", {
    startUt: 0,
    endUt: 100,
    patchStartTransition: TransitionType.Initial,
    patchEndTransition: TransitionType.Final,
    peA: 1_000_000,
    apA: 1_000_000,
    inc: 0,
    ecc: 0,
    epoch: 0,
    period: 100,
    argPe: 0,
    sma: 1_000_000,
    lan: 0,
    meanAnomalyAtEpoch: 0,
    referenceBody: "Kerbin",
    semiLatusRectum: 1_000_000,
    semiMinorAxis: 1_000_000,
    closestEncounterBody: null,
    ...overrides,
  });
}

/** A transfer about Kerbin that meets the Mun at UT 100 and orbits it from there. */
const CHAIN = [
  patch({ endUt: 100, patchEndTransition: TransitionType.Encounter }),
  patch({
    referenceBody: "Mun",
    sma: 300_000,
    period: 60,
    epoch: 100,
    startUt: 100,
    endUt: 160,
    patchStartTransition: TransitionType.Encounter,
  }),
];

function answers(...inputs: UsePatchChainInput[]): (PatchChain | null)[] {
  const seen: (PatchChain | null)[] = [];
  function Probe({ input }: { input: UsePatchChainInput }) {
    seen.push(usePatchChain(input));
    return null;
  }
  const view = render(<Probe input={inputs[0]} />);
  for (const input of inputs.slice(1)) view.rerender(<Probe input={input} />);
  return seen;
}

const ASKED: UsePatchChainInput = {
  patches: CHAIN,
  frameBodyName: "Kerbin",
  facts: FACTS,
  ut: 10,
};

describe("usePatchChain", () => {
  it("draws a patch about a child at the place the catalogue puts that child when the patch begins", () => {
    const [chain] = answers(ASKED);
    expect(chain?.arcs.map((a) => a.referenceBody)).toEqual(["Kerbin", "Mun"]);
    // The Mun moves along its 12 Mm orbit, so where it is at UT 100 is not where it is at UT 0.
    const munAt100 = {
      x: MUN_SMA * Math.cos(100 * Math.sqrt(3.5316e12 / MUN_SMA ** 3)),
      y: MUN_SMA * Math.sin(100 * Math.sqrt(3.5316e12 / MUN_SMA ** 3)),
    };
    for (const p of chain?.arcs[1].points ?? []) {
      expect(Math.hypot(p.x - munAt100.x, p.y - munAt100.y)).toBeCloseTo(
        300_000,
        -1,
      );
    }
    expect(chain?.crossings).toHaveLength(1);
    expect(chain?.crossings[0]).toMatchObject({
      kind: "encounter",
      body: "Mun",
      patchIndex: 1,
    });
  });

  it("returns the same chain while nothing it was asked about changes", () => {
    const [first, second] = answers(ASKED, { ...ASKED });
    expect(first).not.toBeNull();
    expect(second).toBe(first);
  });

  it("samples again at a new instant, and the current patch starts there", () => {
    const [first, second] = answers(ASKED, { ...ASKED, ut: 40 });
    expect(second).not.toBe(first);
    expect(first?.arcs[0].isCurrent).toBe(true);
    const start = second?.arcs[0].points[0];
    // A 100 s circular orbit of 1 Mm, 40 s in: 144 degrees round from +x.
    expect(start?.x).toBeCloseTo(1_000_000 * Math.cos(0.8 * Math.PI), 3);
    expect(start?.y).toBeCloseTo(1_000_000 * Math.sin(0.8 * Math.PI), 3);
  });

  it("takes an instant before the chain's first patch as that patch's start", () => {
    const later = CHAIN.map((p, i) =>
      i === 0 ? patch({ startUt: 20, endUt: 100 }) : p,
    );
    const [chain] = answers({ ...ASKED, patches: later, ut: 5 });
    expect(chain?.arcs[0].isCurrent).toBe(true);
    expect(chain?.arcs[0].points[0].x).toBeCloseTo(
      1_000_000 * Math.cos(0.4 * Math.PI),
      3,
    );
  });

  it("leaves out a patch about a body the catalogue cannot place", () => {
    const [chain] = answers({
      ...ASKED,
      patches: [
        CHAIN[0],
        patch({ ...{ referenceBody: "Duna" }, startUt: 100, endUt: 160 }),
      ],
    });
    expect(chain?.arcs.map((a) => a.referenceBody)).toEqual(["Kerbin"]);
  });

  it.each([
    ["no chain", { patches: undefined }],
    ["an empty chain", { patches: [] }],
    ["no frame body", { frameBodyName: null }],
    ["no catalogue", { facts: undefined }],
    ["no instant", { ut: null }],
  ] as const)("is null with %s", (_name, missing) => {
    expect(answers({ ...ASKED, ...missing })[0]).toBeNull();
  });
});
