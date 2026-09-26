import { usePartsLive, useTopology } from "@ksp-gonogo/data";
import { useEffect, useMemo, useState } from "react";
import type { Contribution } from "./flow";

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
  return { topology, liveByFlightId, resourcesWithFlow };
}

/** The focused resource: seeded from config, picked by the operator, and auto-jumped only while never picked. */
export function useResourcePick(
  defaultResource: string,
  resourcesWithFlow: readonly string[],
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
    if (!resourcesWithFlow.includes(resource)) {
      setResource(resourcesWithFlow[0]);
    }
  }, [resourcesWithFlow, resource, userPicked]);

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
  const totalProduced = producers.reduce((s, c) => s + c.flow, 0);
  const totalConsumed = consumers.reduce((s, c) => s + c.flow, 0);
  const net = totalProduced + totalConsumed;
  const storage = useMemo(() => {
    let amt = 0;
    let max = 0;
    for (const slice of liveByFlightId.values()) {
      const row = slice.resources?.[resource];
      if (!row) continue;
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
    storage,
  };
}
