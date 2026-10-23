import { CORE_UPLINK_CLIENT } from "@ksp-gonogo/core";
import { contactPhase, useProcessor } from "@ksp-gonogo/sitrep-client";
import {
  type CatalogEntry,
  stillTrue,
  type Value,
} from "@ksp-gonogo/sitrep-sdk";

/**
 * A craft the centre has not heard from for longer than it expected: `overdue` past the instant its return was due, `lost` once the home centre has declared it so. The centre cannot tell why, so neither says the craft was destroyed.
 */
export interface ContactLoss {
  phase: "overdue" | "lost";
  /** The universal time the centre last had a link to the craft, or null when it knows of none. */
  sinceUt: Value<"ut"> | null;
}

export type ContactLossEntry = Pick<
  CatalogEntry,
  "contact" | "expectedReturnUt" | "overdueAfterUt" | "lastContactUt"
>;

/** Pure core: the loss a catalog entry shows at `nowUt`, or null while the craft is in contact, expected back on time, or has no word of a route at all. */
export function computeContactLoss(
  entry: ContactLossEntry | undefined,
  nowUt: number,
): ContactLoss | null {
  const phase = contactPhase(entry, nowUt);
  if (phase !== "overdue" && phase !== "lost") return null;
  return { phase, sinceUt: entry?.lastContactUt ?? null };
}

/* A processor, because a silent craft goes overdue on the view clock, which is no declared dep; it notifies only when the answer changes. */
const VESSEL_CONTACT_LOSS = CORE_UPLINK_CLIENT.registerProcessor({
  id: "vessel-contact-loss",
  deps: [
    { reading: "vessel.identity" },
    { reading: "trackingStation.catalog" },
  ] as const,
  compute: ([identityReading, catalogReading], { viewUt }) => {
    const vesselId = stillTrue(identityReading, null)?.vesselId;
    if (typeof vesselId !== "string" || vesselId === "") return null;
    const entry = stillTrue(catalogReading, null)?.entries.find(
      (e) => e.vesselId === vesselId,
    );
    return computeContactLoss(entry, viewUt);
  },
});

/**
 * The active vessel's lost-contact state from its catalog entry, or null while it is in contact or has not yet passed its overdue time. Used by the Landing Status hero and the flight alert banner to say a craft is overdue or presumed lost instead of showing its last held descent as live.
 */
export function useContactLoss(): ContactLoss | null {
  const reading = useProcessor(VESSEL_CONTACT_LOSS);
  return reading?.state === "observed" || reading?.state === "held"
    ? (reading.value ?? null)
    : null;
}
