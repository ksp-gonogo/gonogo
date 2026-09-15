import "./reckoner-test-topics";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { afterEach, describe, expect, it } from "vitest";
import type { ReckonerDefinition, UncertaintyBand } from "./reading";
import {
  clearReckoners,
  getReckonerExemptions,
  registerReckoner,
} from "./reckoners";
import { makeMeta } from "./stub-transport";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

/**
 * The two input rules the store applies to every registered model without the
 * model asking: a reach no further than its inputs reach, and a band no
 * narrower than its inputs' own uncertainty warrants.
 *
 * Every case here drives a SYNTHETIC model, because no shipped model has a
 * banded or horizon-bearing input today: every registered model declares either
 * no deps at all or a Topic nobody else models. The mechanism is what is under
 * test, and `reckoner-input-rule-ledger.test.ts` is the file that says out loud
 * how much of the shipped tree it currently bites on.
 *
 * The owner is never `"core"` in these cases. `getReckoner` elects the sole
 * non-core owner over the vanilla, so registering as an Uplink would is both the
 * realistic path and the one that proves enforcement is owner-agnostic.
 */

const INPUT = "test.temperature";
const UPLINK = "test-uplink";

function newStore(viewUt: number): TimelineStore {
  const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
  clock.scrubTo(viewUt);
  const store = new TimelineStore(clock);
  store.beginFrame();
  return store;
}

function ingestPoint(
  store: TimelineStore,
  topic: string,
  validAt: number,
  payload: unknown,
): void {
  store.ingest(topic, {
    validAt,
    payload,
    meta: makeMeta({ validAt, deliveredAt: validAt }),
    epoch: 0,
  });
}

/** A store holding the input and both dependents, graded stale so every model is consulted. */
function storeWithInput(viewUt: number): TimelineStore {
  const store = newStore(viewUt);
  ingestPoint(store, INPUT, 10, 100);
  ingestPoint(store, "test.contact", 10, { relativePosition: 5, name: "a" });
  ingestPoint(store, "vessel.dock", 10, { name: "a" });
  store.setTransportConnected(false);
  store.beginFrame();
  return store;
}

/** The input's own model, which stops reaching at `horizonUt`. */
function inputModel(horizonUt: number): ReckonerDefinition<number> {
  return {
    deps: [],
    reckon: (point, _resolved, { viewUt }) => {
      const from = point.payload;
      if (from === null) return { declined: { reason: "input-absent" } };
      if (viewUt > horizonUt) {
        return {
          declined: {
            reason: "beyond-horizon",
            note: "the seed rate is only good for so long",
          },
        };
      }
      return {
        modelled: [{ path: "", basis: "rate-integration" }],
        reckon: (at: number) => from + (at - 10),
      };
    },
  };
}

/** The input's own model, banding its answer at `kind` and `halfWidth`. */
function bandedInputModel(
  kind: "bound" | "sigma1",
  halfWidth: number,
): ReckonerDefinition<number> {
  return {
    deps: [],
    reckon: (point) => {
      const from = point.payload ?? 0;
      return {
        modelled: [{ path: "", basis: "rate-integration" }],
        reckon: (at: number) => from + (at - 10),
        bandAt: (at: number) => {
          const v = from + (at - 10);
          return {
            "": {
              value: value("m", v),
              lo: value("m", v - halfWidth),
              hi: value("m", v + halfWidth),
              kind,
            },
          };
        },
      };
    },
  };
}

afterEach(() => clearReckoners());

describe("rule 1: a model reaches no further than its inputs do", () => {
  it("withdraws a model whose input is past its own horizon", () => {
    const store = storeWithInput(200);
    registerReckoner(INPUT, UPLINK, inputModel(100));
    registerReckoner("test.contact", UPLINK, {
      deps: [INPUT],
      reckon: () => ({
        modelled: [{ path: "", basis: "rate-integration" }],
        reckon: () => ({ relativePosition: 1, name: "a" }),
      }),
    });

    expect(store.sampleReading("test.contact").reckoning.status).toBe("none");
  });

  it("leaves the same model alone while the input still reaches", () => {
    const store = storeWithInput(50);
    registerReckoner(INPUT, UPLINK, inputModel(100));
    registerReckoner("test.contact", UPLINK, {
      deps: [INPUT],
      reckon: () => ({
        modelled: [{ path: "", basis: "rate-integration" }],
        reckon: () => ({ relativePosition: 1, name: "a" }),
      }),
    });

    expect(store.sampleReading("test.contact").reckoning.status).toBe(
      "available",
    );
  });

  it("names the input that ran out, in the contract's own spelling", () => {
    const store = storeWithInput(200);
    registerReckoner(INPUT, UPLINK, inputModel(100));
    registerReckoner("vessel.dock", UPLINK, {
      deps: [INPUT],
      reckon: () => ({
        modelled: [{ path: "distance", basis: "rate-integration" }],
        reckon: () => ({ distance: value("m", 4) }),
      }),
    });

    const reading = store.sampleReading("vessel.dock");

    expect(reading.reckoning.status).toBe("declined");
    expect(reading.reckoning).toMatchObject({
      status: "declined",
      declined: { reason: "beyond-horizon", input: `@${INPUT}` },
    });
  });

  it("serves the model anyway where the author declared an exemption", () => {
    const store = storeWithInput(200);
    registerReckoner(INPUT, UPLINK, inputModel(100));
    registerReckoner("test.contact", UPLINK, {
      deps: [INPUT],
      exempt: {
        horizon: "the input seeds the integration once and is never read again",
      },
      reckon: () => ({
        modelled: [{ path: "", basis: "rate-integration" }],
        reckon: () => ({ relativePosition: 1, name: "a" }),
      }),
    });

    expect(store.sampleReading("test.contact").reckoning.status).toBe(
      "available",
    );
  });
});

describe("rule 2: a band claims no more than its inputs know", () => {
  /** A dependent model claiming `kind` over a half-width of `halfWidth`. */
  function claiming(
    kind: "bound" | "sigma1",
    halfWidth: number,
    exempt?: string,
  ): ReckonerDefinition<
    { relativePosition: number; name: string },
    { relativePosition: number; name: string },
    readonly ["test.temperature"]
  > {
    return {
      deps: [INPUT],
      ...(exempt ? { exempt: { band: exempt } } : {}),
      reckon: () => ({
        modelled: [{ path: "", basis: "rate-integration" }],
        reckon: () => ({ relativePosition: 1, name: "a" }),
        bandAt: () => ({
          "": {
            value: value("m", 1),
            lo: value("m", 1 - halfWidth),
            hi: value("m", 1 + halfWidth),
            kind,
          },
        }),
      }),
    };
  }

  function bandOf(store: TimelineStore): UncertaintyBand | undefined {
    const reading = store.sampleReading("test.contact");
    if (reading.reckoning.status !== "available") {
      throw new Error(`expected a model, got ${reading.reckoning}`);
    }
    return reading.reckoning.bands?.[""];
  }

  it("caps a bound claim at sigma1 when an input only offers sigma1", () => {
    const store = storeWithInput(50);
    registerReckoner(INPUT, UPLINK, bandedInputModel("sigma1", 3));
    registerReckoner("test.contact", UPLINK, claiming("bound", 0.5));

    expect(bandOf(store)?.kind).toBe("sigma1");
  });

  it("leaves a bound claim alone when every input band is a bound", () => {
    const store = storeWithInput(50);
    registerReckoner(INPUT, UPLINK, bandedInputModel("bound", 3));
    registerReckoner("test.contact", UPLINK, claiming("bound", 0.5));

    expect(bandOf(store)?.kind).toBe("bound");
  });

  it("drops a claim of exactness made over an inexact input", () => {
    const store = storeWithInput(50);
    registerReckoner(INPUT, UPLINK, bandedInputModel("bound", 3));
    registerReckoner("test.contact", UPLINK, claiming("bound", 0));

    expect(bandOf(store)).toBeUndefined();
  });

  it("keeps an exact claim where no input is inexact", () => {
    const store = storeWithInput(50);
    registerReckoner(INPUT, UPLINK, bandedInputModel("bound", 0));
    registerReckoner("test.contact", UPLINK, claiming("bound", 0));

    expect(bandOf(store)?.kind).toBe("bound");
  });

  it("honours a declared exemption and serves the model's own claim", () => {
    const store = storeWithInput(50);
    registerReckoner(INPUT, UPLINK, bandedInputModel("sigma1", 3));
    registerReckoner(
      "test.contact",
      UPLINK,
      claiming("bound", 0.5, "the residual is capped by the integrator"),
    );

    expect(bandOf(store)?.kind).toBe("bound");
  });
});

describe("two models that name each other's topics", () => {
  /*
   * Nothing forbids this: models are registered by topic string, by owners who
   * need not know about each other. Enforcing either rule means asking an
   * input's OWN model how far it reaches and how well it knows its answer, so a
   * pair like this walks in a circle, and unguarded it is a stack overflow on a
   * frame rather than a decline. Both rules are exercised, because they walk the
   * circle down different paths: the horizon check runs before the model does,
   * the band floor runs inside the `bandAt` pull.
   */
  function mutual(bandKind: "bound" | "sigma1" | undefined) {
    return (
      dep: "test.contact" | "test.dock",
    ): ReckonerDefinition<
      { relativePosition: number },
      { relativePosition: number },
      readonly ["test.contact" | "test.dock"]
    > => ({
      deps: [dep],
      reckon: () => ({
        modelled: [{ path: "", basis: "rate-integration" }],
        reckon: () => ({ relativePosition: 1 }),
        ...(bandKind
          ? {
              bandAt: () => ({
                "": {
                  value: value("m", 1),
                  lo: value("m", 0),
                  hi: value("m", 2),
                  kind: bandKind,
                },
              }),
            }
          : {}),
      }),
    });
  }

  it("settles rather than recursing, on the horizon walk", () => {
    const store = storeWithInput(50);
    ingestPoint(store, "test.dock", 10, {
      relativePosition: 1,
      relativePositionError: 0,
    });
    store.beginFrame();
    registerReckoner("test.contact", UPLINK, mutual(undefined)("test.dock"));
    registerReckoner("test.dock", UPLINK, mutual(undefined)("test.contact"));

    expect(store.sampleReading("test.contact").reckoning.status).toBe(
      "available",
    );
  });

  it("settles rather than recursing, on the band walk", () => {
    const store = storeWithInput(50);
    ingestPoint(store, "test.dock", 10, {
      relativePosition: 1,
      relativePositionError: 0,
    });
    store.beginFrame();
    registerReckoner("test.contact", UPLINK, mutual("bound")("test.dock"));
    registerReckoner("test.dock", UPLINK, mutual("sigma1")("test.contact"));

    const reading = store.sampleReading("test.contact");
    if (reading.reckoning.status !== "available") {
      throw new Error(`expected a model, got ${reading.reckoning}`);
    }
    expect(reading.reckoning.bands?.[""]?.kind).toBe("sigma1");
  });
});

describe("an exemption is declared, reasoned and listed", () => {
  it("refuses a registration whose exemption carries no reason", () => {
    expect(() =>
      registerReckoner("test.contact", UPLINK, {
        deps: [],
        exempt: { horizon: "  " },
        reckon: () => ({ declined: { reason: "model-inapplicable" } }),
      }),
    ).toThrow(/reason/);
  });

  it("lists every exemption with its topic, owner, rule and reason", () => {
    registerReckoner(INPUT, UPLINK, {
      deps: [],
      exempt: {
        horizon: "the input is a seed, not a term",
        band: "the residual is capped by the integrator",
      },
      reckon: () => ({ declined: { reason: "model-inapplicable" } }),
    });

    expect(getReckonerExemptions()).toEqual([
      {
        topic: INPUT,
        owner: UPLINK,
        rule: "band",
        reason: "the residual is capped by the integrator",
      },
      {
        topic: INPUT,
        owner: UPLINK,
        rule: "horizon",
        reason: "the input is a seed, not a term",
      },
    ]);
  });

  it("lists nothing for a model that declared no exemption", () => {
    registerReckoner(INPUT, UPLINK, inputModel(100));

    expect(getReckonerExemptions()).toEqual([]);
  });
});
