import type { TopicReading } from "@ksp-gonogo/sitrep-client";
import type { Reading, Value, VesselResources } from "@ksp-gonogo/sitrep-sdk";
import { Meter, type MeterTone } from "@ksp-gonogo/ui";
import { Cluster } from "@ksp-gonogo/ui-kit";

// An EVA kerbal is a real vessel, so its suit resources arrive on `vessel.resources`; the install's life-support profile decides which ones.

/** A resource's amount and capacity as field readings, or `undefined` when the vessel has no tank for it, the one structural absence that hides the meter. */
export function suitTank(
  reading: TopicReading<VesselResources>,
  name: string,
): SuitTank | undefined {
  const carried =
    reading.state === "observed" || reading.state === "stale"
      ? reading.value?.resources?.[name]
      : undefined;
  if (!carried) return undefined;
  const entry = reading.resources[name];
  return { amount: entry.current, capacity: entry.max };
}

export interface SuitTank {
  amount: Reading<Value<"units">>;
  capacity: Reading<Value<"units">>;
}

/** Tone for what is left in a suit tank: full is calm, empty alarms. `undefined` when either half has no figure. */
function suitResourceTone(pair: SuitTank): MeterTone | undefined {
  const amount = pair.amount.value;
  const capacity = pair.capacity.value;
  if (!amount || !capacity?.isPositive()) return undefined;
  const fraction = amount.dividedBy(capacity).magnitude;
  if (fraction <= 0.15) return "nogo";
  if (fraction <= 0.4) return "warn";
  return "go";
}

/** O2 and EC meters for an EVA kerbal; renders nothing when neither resource is carried. */
export function EvaSuitReadout({
  oxygen,
  electricCharge,
}: Readonly<{
  oxygen: SuitTank | undefined;
  electricCharge: SuitTank | undefined;
}>) {
  if (!oxygen && !electricCharge) return null;
  return (
    <Cluster justify="start" wrap aria-label="EVA suit resources">
      {oxygen && (
        <Meter
          label="O2"
          value={oxygen.amount}
          capacity={oxygen.capacity}
          tone={suitResourceTone(oxygen)}
        />
      )}
      {electricCharge && (
        <Meter
          label="EC"
          value={electricCharge.amount}
          capacity={electricCharge.capacity}
          tone={suitResourceTone(electricCharge)}
        />
      )}
    </Cluster>
  );
}
