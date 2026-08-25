import { useMemo } from "react";
import { isThresholdSubject } from "../schema/topicFieldCatalog";
import type { DataKeyMeta } from "../types";
import { useDataSchema } from "./useDataSchema";

/**
 * The Value-restricted subset of `useDataSchema`'s key list: every key an alarm
 * or maneuver-trigger picker may offer.
 *
 * Per the Uplink vocabulary (Domain/Topic/Value/Stream/Asset), a threshold can
 * only be set on a scalar telemetry Value, never a Stream (video) or an Asset (a
 * timeline), and never on a name, a flag, an enum or a whole collection: none of
 * those has a magnitude for a comparison to order.
 *
 * The filter reads the field's KIND, which the contract's own unit token
 * decides, rather than testing for particular unit spellings. Four call sites
 * each used to hand-roll that test against `"bool"` and `"raw"`, tokens the
 * contract does not emit, so the check passed everything it was meant to
 * exclude the moment the vocabulary behind it changed.
 *
 * No hand-maintained allowlist: a key becomes eligible the moment the contract
 * declares the field, and drops out again if the contract stops declaring it.
 */
export function useValueKeys(sourceId = "data"): DataKeyMeta[] {
  const schema = useDataSchema(sourceId);
  return useMemo(() => schema.filter(isThresholdSubject), [schema]);
}
