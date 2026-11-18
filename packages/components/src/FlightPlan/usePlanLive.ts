import { useTelemetry } from "@ksp-gonogo/core";
import {
  CELESTIAL_FACTS,
  DELTA_V_BUDGET,
  useProcessor,
  useViewUt,
} from "@ksp-gonogo/sitrep-client";
import {
  bodyAtIndex,
  Situation,
  stillTrue,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  type TimelineStore,
  useTelemetryOverlay,
} from "@ksp-gonogo/sitrep-sdk/spine";
import { useRef } from "react";
import { useBodyName } from "../shared/useBodyName";
import type { FlightPlan } from "./plan";
import { type PlanLive, type PlanProgress, stepReached } from "./scoring";

interface Latch {
  key: string;
  doneAt: Map<string, Value<"s">>;
  vacuumDvAtLaunch: Value<"m/s"> | undefined;
  groupsAtApply: Map<number, boolean | null> | undefined;
  firedAt: Map<number, Value<"s">>;
}

/**
 * The live flight as a plan reads it, and what the flight has latched while
 * flying the plan: the craft's Δv on the pad, when each step finished, and
 * when each action group first changed state.
 * The latch starts again when the vessel or the plan changes.
 */
export function usePlanLive(plan: FlightPlan | undefined): {
  live: PlanLive;
  progress: PlanProgress;
} {
  const identity = stillTrue(useTelemetry("vessel.identity"), undefined);
  const flight = stillTrue(useTelemetry("vessel.flight"), undefined);
  const control = stillTrue(useTelemetry("vessel.control"), undefined);
  const orbit = stillTrue(useTelemetry("vessel.orbit"), undefined);
  const budget = useProcessor(DELTA_V_BUDGET);
  const viewUt = useViewUt();
  const overlay = useTelemetryOverlay();
  const facts = useProcessor(CELESTIAL_FACTS);
  const body = useBodyName(identity?.parentBodyIndex) ?? undefined;

  const launchUt = identity?.launchUt ?? undefined;
  const missionTime =
    viewUt !== undefined && launchUt !== undefined
      ? viewUt.minus(launchUt).max(0)
      : undefined;
  const budgetValue =
    budget?.state === "observed" || budget?.state === "held"
      ? budget.value
      : undefined;

  const radius =
    facts?.state === "observed" || facts?.state === "held"
      ? (bodyAtIndex(facts.value, orbit?.referenceBodyIndex)?.radius ??
        undefined)
      : undefined;
  const live: PlanLive = {
    missionTime,
    altitude: flight?.altitudeAsl ?? undefined,
    apoapsis: apsis(orbit, radius, 1),
    periapsis: apsis(orbit, radius, -1),
    body,
    landed:
      identity === undefined
        ? undefined
        : identity.situation === Situation.Landed ||
          identity.situation === Situation.Splashed,
    dvLeft: budgetValue?.totalActual ?? undefined,
    dvVacuum: budgetValue?.totalVac ?? undefined,
    firedAt: new Map(),
  };

  const key = `${identity?.vesselId ?? ""}/${plan?.id ?? ""}`;
  const latch = useRef<Latch | undefined>(undefined);
  if (latch.current?.key !== key) {
    latch.current = {
      key,
      doneAt: new Map(),
      vacuumDvAtLaunch: undefined,
      groupsAtApply: undefined,
      firedAt: new Map(),
    };
  }
  const l = latch.current;

  latchGroups(l, control?.actionGroups ?? undefined, missionTime);
  live.firedAt = l.firedAt;

  // On the pad the craft's Δv is the budget the whole plan is scored from, so it is held until lift-off.
  const onPad =
    missionTime === undefined || identity?.situation === Situation.PreLaunch;
  if (onPad) l.vacuumDvAtLaunch = live.dvVacuum;

  if (plan && !onPad && missionTime !== undefined) {
    for (const step of plan.steps) {
      if (l.doneAt.has(step.id)) continue;
      if (!stepReached(step, live)) break;
      l.doneAt.set(step.id, missionTime);
    }
  }

  // A predicted run is known whole, so what has happened by the cursor is read from the run, not from where the cursor has been.
  if (
    plan &&
    overlay?.mode === "design" &&
    launchUt !== undefined &&
    viewUt !== undefined
  ) {
    const read = seriesProgress(
      overlay.store,
      plan,
      launchUt,
      viewUt,
      facts?.state === "observed" || facts?.state === "held"
        ? (bodyAtIndex(facts.value, identity?.parentBodyIndex)?.radius ??
            undefined)
        : undefined,
      body,
    );
    live.firedAt = read.firedAt;
    return {
      live,
      progress: {
        doneAt: read.doneAt,
        vacuumDvAtLaunch: read.vacuumDvAtLaunch,
      },
    };
  }

  return {
    live,
    progress: { doneAt: l.doneAt, vacuumDvAtLaunch: l.vacuumDvAtLaunch },
  };
}

/** A sample's field as a plain number, whether the store holds it bare or as a value. */
const n = (v: unknown): number | undefined => {
  if (v == null) return undefined;
  const x = Number(v);
  return Number.isFinite(x) ? x : undefined;
};

function at<P>(
  points: ReadonlyArray<{ validAt: number; payload: P | null }>,
  t: number,
): P | undefined {
  let found: P | undefined;
  for (const p of points) {
    if (p.validAt > t) break;
    if (p.payload != null) found = p.payload;
  }
  return found;
}

/**
 * Walks a predicted run from lift-off to the cursor, as the flight would have
 * met it: the Δv on the pad, the moment each step was reached and the moment
 * each action group first changed. `radius` is the body's, which turns the
 * orbit's elements into apoapsis and periapsis heights.
 */
function seriesProgress(
  store: TimelineStore,
  plan: FlightPlan,
  launchUt: Value<"ut">,
  cursorUt: Value<"ut">,
  radius: number | undefined,
  body: string | undefined,
): {
  doneAt: Map<string, Value<"s">>;
  firedAt: Map<number, Value<"s">>;
  vacuumDvAtLaunch: Value<"m/s"> | undefined;
} {
  const lift = Number(launchUt);
  const cursor = Number(cursorUt);
  const range = <P>(topic: string) =>
    (store.sampleRange<P>(topic, Number.NEGATIVE_INFINITY, cursor) ??
      []) as ReadonlyArray<{ validAt: number; payload: P | null }>;
  const flight = range<{ altitudeAsl?: unknown }>("vessel.flight");
  const orbits = range<{ sma?: unknown; ecc?: unknown }>("vessel.orbit");
  const control = range<{
    actionGroups?: Array<{ index: number; state?: boolean | null }> | null;
  }>("vessel.control");
  const dv = range<{ totalDvVac?: unknown }>("dv.summary");

  const padDv = n(at(dv, lift)?.totalDvVac);
  const doneAt = new Map<string, Value<"s">>();
  const firedAt = new Map<number, Value<"s">>();
  const times = [
    ...new Set([...flight, ...orbits, ...control].map((p) => p.validAt)),
  ]
    .filter((t) => t > lift && t <= cursor)
    .sort((a, b) => a - b);
  const groupsAtLift = new Map(
    (at(control, lift)?.actionGroups ?? []).map((g) => [
      g.index,
      g.state ?? null,
    ]),
  );
  let next = 0;
  for (const t of times) {
    const since = value("s", t - lift);
    for (const g of at(control, t)?.actionGroups ?? []) {
      const was = groupsAtLift.get(g.index);
      if (
        !firedAt.has(g.index) &&
        g.state != null &&
        was != null &&
        g.state !== was
      ) {
        firedAt.set(g.index, since);
      }
    }
    const o = at(orbits, t);
    const sma = n(o?.sma);
    const ecc = n(o?.ecc);
    const apsis = (sign: 1 | -1) =>
      sma === undefined || ecc === undefined || radius === undefined
        ? undefined
        : value("m", sma * (1 + sign * ecc) - radius);
    const alt = n(at(flight, t)?.altitudeAsl);
    const sample: PlanLive = {
      missionTime: since,
      altitude: alt === undefined ? undefined : value("m", alt),
      apoapsis: apsis(1),
      periapsis: apsis(-1),
      body,
      landed: false,
      dvLeft: undefined,
      dvVacuum: undefined,
      firedAt,
    };
    while (next < plan.steps.length) {
      const step = plan.steps[next];
      if (!step || !stepReached(step, sample)) break;
      doneAt.set(step.id, since);
      next += 1;
    }
  }
  return {
    doneAt,
    firedAt,
    vacuumDvAtLaunch: padDv === undefined ? undefined : value("m/s", padDv),
  };
}

/** Records the state of every action group when the plan starts, then the mission time each one first changes from it. */
function latchGroups(
  l: Latch,
  groups: ReadonlyArray<{ index: number; state?: boolean | null }> | undefined,
  missionTime: Value<"s"> | undefined,
): void {
  if (!groups) return;
  if (l.groupsAtApply === undefined) {
    l.groupsAtApply = new Map(groups.map((g) => [g.index, g.state ?? null]));
    return;
  }
  if (missionTime === undefined) return;
  for (const g of groups) {
    const was = l.groupsAtApply.get(g.index);
    const changed = g.state != null && was != null && g.state !== was;
    if (changed && !l.firedAt.has(g.index)) l.firedAt.set(g.index, missionTime);
  }
}

/*
 * The apsides are the conic's own shape, constants of the orbit as observed,
 * so they are read from its elements: an orbit the model declines to carry
 * forward, such as one dipping into the atmosphere on the way up, still has
 * them.
 */
function apsis(
  elements: { sma: Value<"m">; ecc: Value<"1"> } | undefined,
  radius: number | undefined,
  sign: 1 | -1,
): Value<"m"> | undefined {
  if (elements === undefined || radius === undefined) return undefined;
  const e = Number(elements.ecc);
  if (!Number.isFinite(e) || (sign === 1 && e >= 1)) return undefined;
  return elements.sma.scaled(1 + sign * e).minus(radius);
}
