import { useStream } from "@ksp-gonogo/sitrep-client";
import {
  type CarriedCurrency,
  type EvaCrewMember,
  type EvaKerbal,
  stillTrue,
} from "@ksp-gonogo/sitrep-sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { currencyOf } from "../shared/currencyOf";
import { evaKerbalTopic, type KerbalHeldResult, kerbalHeldOf } from "./parsers";

interface Held {
  results: readonly KerbalHeldResult[];
  from: CarriedCurrency;
}

/*
 * One read per kerbal outside, each on that kerbal's own Topic, so each result is
 * drawn by the link of the kerbal who holds it. A hook cannot be called once per
 * roster entry, so a probe component per kerbal does the read and reports it here.
 */
function KerbalProbe({
  member,
  report,
}: Readonly<{
  member: EvaCrewMember;
  report: (id: string, held: Held | null) => void;
}>) {
  const id = member.kerbalVesselId;
  const reading = useStream<EvaKerbal>(id ? evaKerbalTopic(id) : "");
  const state = stillTrue(reading, undefined);
  const results = useMemo(() => kerbalHeldOf(member, state), [member, state]);
  const from = currencyOf(reading);
  // Results and currency are rebuilt on every read, so the effect keys on their content.
  const signature = JSON.stringify([results, from]);
  const latest = useRef({ results, from });
  latest.current = { results, from };
  // biome-ignore lint/correctness/useExhaustiveDependencies: signature stands for the content of results and from
  useEffect(() => {
    if (!id) return;
    report(id, latest.current);
    return () => report(id, null);
  }, [id, report, signature]);
  return null;
}

/**
 * What the kerbals listed on `eva.crew` are holding, read off each kerbal's own Topic.
 * `probes` is rendered once beside the caller's output; `held` and `from` follow the reads.
 */
export function useKerbalHeld(roster: readonly EvaCrewMember[]): {
  probes: JSX.Element;
  held: KerbalHeldResult[];
  from: CarriedCurrency[];
} {
  const [byKerbal, setByKerbal] = useState<ReadonlyMap<string, Held>>(
    new Map(),
  );
  const report = useCallback((id: string, held: Held | null) => {
    setByKerbal((previous) => {
      const before = previous.get(id);
      if (before && held && JSON.stringify(before) === JSON.stringify(held)) {
        return previous;
      }
      if (!before && !held) return previous;
      const next = new Map(previous);
      if (held) next.set(id, held);
      else next.delete(id);
      return next;
    });
  }, []);

  const ids = roster.flatMap((m) =>
    m.kerbalVesselId ? [m.kerbalVesselId] : [],
  );
  const held = ids.flatMap((id) => byKerbal.get(id)?.results ?? []);
  const from = ids.flatMap((id) => {
    const entry = byKerbal.get(id);
    return entry ? [entry.from] : [];
  });
  const probes = (
    <>
      {roster.map((member) => (
        <KerbalProbe
          key={member.kerbalVesselId ?? member.name ?? ""}
          member={member}
          report={report}
        />
      ))}
    </>
  );
  return { probes, held, from };
}
