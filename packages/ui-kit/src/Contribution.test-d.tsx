// Type-level proof that a slot's entries are the props of the one component that draws them, run by the package `typecheck`.

import type { MeterEntry } from "@ksp-gonogo/sitrep-sdk";
import { Badge } from "./Badge";
import { Contribution } from "./Contribution";

/** A list of meters, which is what a slot of meter entries is drawn by. */
function MeterList(_props: { entries: readonly MeterEntry[] }) {
  return null;
}

export const drawsMeters = <Contribution slot="meters" component={MeterList} />;

export const notBadges = (
  // @ts-expect-error a badge takes no `entries`, so the slot cannot be given to it
  <Contribution slot="meters" component={Badge} />
);

export const notAnotherEntryKind = (
  <Contribution
    slot="meters"
    // @ts-expect-error a list of badge entries cannot draw the meters slot
    component={(_props: { entries: readonly { tone: "go" }[] }) => null}
  />
);
