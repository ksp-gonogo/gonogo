import { useTelemetry } from "@ksp-gonogo/core";
import { useViewUt } from "@ksp-gonogo/sitrep-client";
import {
  readingOf,
  stillTrue,
  type TinyEssential,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { parseContracts } from "./contracts";

/** A list that did not arrive has no count, which is not a count of zero. */
function countOf(raw: unknown): Value<"count"> | undefined {
  const entries = parseContracts(raw);
  return entries === null ? undefined : value("count", entries.length);
}

/**
 * How long until the soonest active deadline. A contract with a deadline of zero
 * has none, and a board with no deadline says so rather than drawing the null
 * token, which would claim nothing arrived.
 */
function dueEssential(
  career: ReturnType<typeof useTelemetry<"career.status">>,
  nowUt: Value<"ut"> | undefined,
): TinyEssential {
  const label = "Due in";
  // Deadlines move only when the board does, so a held board still dates them.
  const held = stillTrue(career, undefined);
  const active = parseContracts(held?.contracts?.active);
  if (active === null || nowUt === undefined) return { label, value: null };
  const deadlines = active.map((c) => c.deadlineUt).filter((ut) => ut > 0);
  if (deadlines.length === 0) return { label, word: "NONE" };
  const remaining = value("ut", Math.min(...deadlines)).minus(nowUt);
  if (!remaining.isPositive()) return { label, word: "EXPIRED", tone: "nogo" };
  return { label, value: readingOf(career, () => remaining) };
}

/** What the board holds and how long until the first of it falls due, the deadline ahead of the offers since a tile too short drops the last. */
export function useContractEssentials(): readonly TinyEssential[] {
  const career = useTelemetry("career.status");
  const nowUt = useViewUt();
  return [
    {
      label: "Active",
      value: readingOf(career, (c) => countOf(c.contracts?.active)),
    },
    dueEssential(career, nowUt),
    {
      label: "Offered",
      value: readingOf(career, (c) => countOf(c.contracts?.offered)),
    },
  ];
}
