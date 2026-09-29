import { useTelemetry } from "@ksp-gonogo/core";
import { type SpaceCenterState, useStream } from "@ksp-gonogo/sitrep-client";
import {
  readingOf,
  stillTrue,
  type TinyEssential,
} from "@ksp-gonogo/sitrep-sdk";

/** The balance, and whether a vehicle is on the pad. */
export function useSpaceCenterEssentials(): readonly TinyEssential[] {
  const career = useTelemetry("career.status");
  // The pad changes only when a vessel rolls out or launches, so the last report holds, as in the body.
  const padOccupied = stillTrue(
    useStream<SpaceCenterState>("spaceCenter.state"),
    undefined,
  )?.padOccupied;
  return [
    {
      label: "Funds",
      value: readingOf(career, (c) => c.balances?.funds ?? undefined),
    },
    padEssential(padOccupied),
  ];
}

function padEssential(padOccupied: boolean | null | undefined): TinyEssential {
  if (padOccupied === true) return { label: "Pad", word: "ACTIVE", tone: "go" };
  if (padOccupied === false) return { label: "Pad", word: "CLEAR" };
  return { label: "Pad", value: null };
}
