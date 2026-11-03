import { JourneyEventKind } from "../__generated__/contract";
import type { PendingEntry } from "../command-delay";
import { value } from "../unit-system/value";
import type { Journey, JourneyEvent } from "./comms-journey";
import type { PendingUplinkQueueLike } from "./resolve-tracked";

/*
 * The centre's plan can predict that a command will wait at a relay, but the
 * centre learns that it does only when the relay's hold report reaches it,
 * which is no sooner than light carries it home. Until then the command is
 * drawn as one going straight out at the speed of light; from the report on,
 * as waiting where the relay says; from the relay's departure report on, as
 * going on from there. A reply settles it either way.
 */

/** The reports about one queue entry, oldest first. */
function reportsAbout(
  entry: PendingEntry,
  journey: Journey | null,
): JourneyEvent[] {
  if (!journey) return [];
  return journey.events
    .filter((e) => e.about === entry.id)
    .sort((a, b) => a.atUt.compare(b.atUt));
}

/** The entry as the centre knows it, from its own plan and the reports that have reached it. */
export function entryAsKnown(
  entry: PendingEntry,
  journey: Journey | null,
): PendingEntry {
  if (entry.predictedHeldAt == null) return entry;
  const reports = reportsAbout(entry, journey);
  const held = reports.find((e) => e.kind === JourneyEventKind.Held);
  const departed = held
    ? reports.find(
        (e) =>
          e.kind === JourneyEventKind.Departed && !e.atUt.lessThan(held.atUt),
      )
    : undefined;
  const sent = entry.dispatchedAt;
  const from = entry.predictedHeldFromUt;
  const until = entry.predictedHeldUntilUt;
  const arrival = entry.predictedArrivalUt;
  const reply = entry.predictedReplyUt;
  // The light-time out to the craft and back, from the plan's own hops.
  const out =
    from != null && until != null && arrival != null
      ? from.minus(sent).plus(arrival.minus(until))
      : null;
  const back = reply != null && arrival != null ? reply.minus(arrival) : out;
  if (!held) {
    // A command held at the centre itself is known held at once; nothing is on its way to report it.
    if (entry.predictedHeldAt === entry.vantage || out === null) return entry;
    return {
      ...entry,
      predictedHeldAt: null,
      predictedHeldFromUt: null,
      predictedHeldUntilUt: null,
      predictedArrivalUt: sent.plus(out),
      predictedReplyUt: sent.plus(out).plus(back ?? out),
    };
  }
  const onward =
    departed?.untilUt != null
      ? departed.untilUt.minus(departed.atUt)
      : until != null && arrival != null
        ? arrival.minus(until)
        : value("s", 0);
  // Until its departure is heard the command is where the relay last said, for as long as it can last there.
  const leaves =
    departed?.atUt ?? entry.expiresAtUt ?? held.untilUt ?? until ?? held.atUt;
  const reaches = leaves.plus(onward);
  return {
    ...entry,
    predictedHeldAt: held.at,
    predictedHeldFromUt: held.atUt,
    predictedHeldUntilUt: leaves,
    predictedArrivalUt: reaches,
    predictedReplyUt: reaches.plus(back ?? onward),
  };
}

/** The queue with each entry as the centre knows it. */
export function queueAsKnown(
  queue: PendingUplinkQueueLike | undefined,
  journey: Journey | null,
): PendingUplinkQueueLike | undefined {
  if (!queue?.pending.some((e) => e.predictedHeldAt != null)) {
    return queue;
  }
  return {
    ...queue,
    pending: queue.pending.map((e) => entryAsKnown(e, journey)),
  };
}
