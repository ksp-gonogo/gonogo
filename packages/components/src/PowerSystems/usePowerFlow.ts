import { useActionInput, useTelemetry } from "@ksp-gonogo/core";
import { usePartsLive, useTopology } from "@ksp-gonogo/data";
import { useEffect, useMemo, useState } from "react";
import type { PowerSystemsActions } from "./config";
import { type Contribution, countUnratedProcesses } from "./flow";

/** The vessel's topology, each part's live slice, and the resources any part reports a flow for. */
export function useLiveParts() {
  const topology = useTopology();
  const flightIds = useMemo(
    () => topology?.parts.map((p) => p.flightId) ?? [],
    [topology],
  );
  const liveByFlightId = usePartsLive(flightIds);
  const resourcesWithFlow = useMemo(() => {
    const set = new Set<string>();
    for (const slice of liveByFlightId.values()) {
      if (!slice.resources) continue;
      for (const [name, row] of Object.entries(slice.resources)) {
        if (typeof row.flow === "number") set.add(name);
      }
    }
    return Array.from(set).sort();
  }, [liveByFlightId]);
  const resourcesPresent = useMemo(() => {
    const set = new Set<string>();
    for (const slice of liveByFlightId.values()) {
      if (!slice.resources) continue;
      for (const [name, row] of Object.entries(slice.resources)) {
        if (row) set.add(name);
      }
    }
    return Array.from(set).sort();
  }, [liveByFlightId]);
  return { topology, liveByFlightId, resourcesWithFlow, resourcesPresent };
}

/**
 * The focused resource: seeded from config, picked by the operator, and auto-jumped only while never picked and only when the craft carries none of it. A resource that is stored with no flow yet (a battery before anything draws) stays focused.
 */
export function useResourcePick(
  defaultResource: string,
  resourcesWithFlow: readonly string[],
  resourcesPresent: readonly string[],
) {
  const [resource, setResource] = useState(defaultResource);
  // An explicit pick is sticky through a transient flow dropout; only a never-picked default auto-jumps.
  const [userPicked, setUserPicked] = useState(false);
  useEffect(() => {
    setResource(defaultResource);
    setUserPicked(false);
  }, [defaultResource]);
  useEffect(() => {
    if (userPicked) return;
    if (resourcesWithFlow.length === 0) return;
    if (
      !resourcesWithFlow.includes(resource) &&
      !resourcesPresent.includes(resource)
    ) {
      setResource(resourcesWithFlow[0]);
    }
  }, [resourcesWithFlow, resourcesPresent, resource, userPicked]);

  // The current pick stays in the options even when its flow has vanished, so the select keeps showing it.
  const pickerResources = useMemo(
    () =>
      resourcesWithFlow.includes(resource)
        ? resourcesWithFlow
        : [...resourcesWithFlow, resource].sort(),
    [resourcesWithFlow, resource],
  );

  const pick = (name: string) => {
    setResource(name);
    setUserPicked(true);
  };
  return { resource, pickerResources, pick };
}

type LiveParts = ReturnType<typeof useLiveParts>;

/** One resource's per-part flow split into producers, consumers and idle deployables, with totals and storage. */
export function useResourceBreakdown(
  topology: LiveParts["topology"],
  liveByFlightId: LiveParts["liveByFlightId"],
  resource: string,
) {
  // A zero-flow part with a nominalFlow is an idle deployable and is listed; storage-only parts are not.
  const contributions = useMemo<Contribution[]>(() => {
    const out: Contribution[] = [];
    if (!topology) return out;
    for (const part of topology.parts) {
      const slice = liveByFlightId.get(part.flightId);
      const row = slice?.resources?.[resource];
      if (!row) continue;
      const hasFlow = typeof row.flow === "number" && row.flow !== 0;
      const hasNominal =
        typeof row.nominalFlow === "number" && row.nominalFlow !== 0;
      if (!hasFlow && !hasNominal) continue;
      out.push({
        flightId: part.flightId,
        partTitle: part.title ?? part.name,
        flow: row.flow ?? 0,
        flowKnown: typeof row.flow === "number",
        nominalFlow: row.nominalFlow,
      });
    }
    return out;
  }, [topology, liveByFlightId, resource]);

  const producers = useMemo(
    () =>
      contributions.filter((c) => c.flow > 0).sort((a, b) => b.flow - a.flow),
    [contributions],
  );
  const consumers = useMemo(
    () =>
      contributions.filter((c) => c.flow < 0).sort((a, b) => a.flow - b.flow),
    [contributions],
  );
  const idle = useMemo(
    () =>
      contributions
        .filter(
          (c) =>
            c.flow === 0 &&
            typeof c.nominalFlow === "number" &&
            c.nominalFlow !== 0,
        )
        .sort(
          (a, b) => Math.abs(b.nominalFlow ?? 0) - Math.abs(a.nominalFlow ?? 0),
        ),
    [contributions],
  );
  const unratedCount = useMemo(
    () =>
      topology
        ? countUnratedProcesses(topology.parts, liveByFlightId, resource)
        : 0,
    [topology, liveByFlightId, resource],
  );
  const totalProduced = producers.reduce((s, c) => s + c.flow, 0);
  const totalConsumed = consumers.reduce((s, c) => s + c.flow, 0);
  const net = totalProduced + totalConsumed;
  // Totals sum measured flows only; with none measured they are unknown rather than zero.
  const flowMeasured = useMemo(() => {
    for (const slice of liveByFlightId.values()) {
      if (typeof slice.resources?.[resource]?.flow === "number") return true;
    }
    return false;
  }, [liveByFlightId, resource]);
  const storage = useMemo(() => {
    let amt = 0;
    let max = 0;
    for (const slice of liveByFlightId.values()) {
      const row = slice.resources?.[resource];
      if (!row) continue;
      // One store that could not be read leaves the total unknown, not short.
      if (row.amount == null || row.maxAmount == null) return null;
      amt += row.amount;
      max += row.maxAmount;
    }
    return { amount: amt, maxAmount: max };
  }, [liveByFlightId, resource]);
  return {
    contributions,
    producers,
    consumers,
    idle,
    totalProduced,
    totalConsumed,
    net,
    flowMeasured,
    unratedCount,
    storage,
  };
}

/** Binds the next-resource action: it steps the pick through the resources that have flow, whichever size the widget is drawn at. */
export function useCycleResourceAction(
  resourcesWithFlow: readonly string[],
  resource: string,
  pick: (name: string) => void,
) {
  useActionInput<PowerSystemsActions>({
    "cycle-resource": (payload) => {
      if (payload.kind === "button" && payload.value !== true) return undefined;
      if (resourcesWithFlow.length === 0) return undefined;
      const idx = resourcesWithFlow.indexOf(resource);
      const next = resourcesWithFlow[(idx + 1) % resourcesWithFlow.length];
      pick(next);
      return { resource: next };
    },
  });
}

/** A wire rate as the plain EC per second the totals arithmetic and the row figures take, undefined while it is null. */
function plainRate(rate: { valueOf(): number } | null | undefined) {
  return rate == null ? undefined : Number(rate);
}

/**
 * The draw measured from the vessel's stored electric charge, each figure undefined while it cannot be known (batteries full or empty, or the figure held). Only electric charge has one; any other resource reads all three as undefined.
 */
export function useMeasuredCharge(resource: string) {
  const reading = useTelemetry("parts.power");
  const power = reading.state === "observed" ? reading.value : undefined;
  const isCharge = resource === "ElectricCharge";
  return {
    /** The stream answered and says the stored charge is not moving, so no draw can be read from it. */
    unknown: isCharge && power != null && power.netChargeRateEc === null,
    net: plainRate(isCharge ? power?.netChargeRateEc : undefined),
    consumption: plainRate(isCharge ? power?.totalConsumptionEc : undefined),
    other: plainRate(isCharge ? power?.unattributedConsumptionEc : undefined),
  };
}
