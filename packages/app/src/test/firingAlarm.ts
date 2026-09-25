import { resolveValueTopic } from "@ksp-gonogo/sitrep-client";
import { KspParameterState } from "@ksp-gonogo/sitrep-sdk";
import {
  type ContractParameterTrigger,
  modOwnsLatch,
  type ThresholdTrigger,
} from "../alarms/types";

/** An alarm this side evaluates for itself, and the reading that makes it due. */
export interface FiringAlarm {
  trigger: ThresholdTrigger | ContractParameterTrigger;
  /**
   * The Topic record whose arrival makes the alarm due. Publishing it on the
   * stream is all a test does to make it fire.
   */
  due: { topic: string; record: unknown };
}

const ALTITUDE_KEY = "vessel.state.altitudeAsl";

function candidates(sustainSeconds: number): FiringAlarm[] {
  const altitudeTopic = resolveValueTopic("data", ALTITUDE_KEY);
  if (altitudeTopic === undefined) {
    throw new Error(`firingAlarm: no stream home for "${ALTITUDE_KEY}"`);
  }
  return [
    {
      trigger: {
        kind: "threshold",
        dataKey: ALTITUDE_KEY,
        op: ">=",
        value: 70_000,
        sustainSeconds,
      },
      due: { topic: altitudeTopic, record: 70_500 },
    },
    {
      trigger: {
        kind: "contract-parameter",
        contractId: 42,
        parameterTitle: "Orbit the Mun",
        targetState: "Complete",
        sustainSeconds,
      },
      due: {
        topic: "career.status",
        record: {
          contracts: {
            active: [
              {
                id: "42",
                parameters: [
                  {
                    title: "Orbit the Mun",
                    stateOrdinal: KspParameterState.Complete,
                  },
                ],
              },
            ],
          },
        },
      },
    },
  ];
}

/**
 * An alarm whose only job is to fire, for a test about what a fire DOES rather
 * than about any trigger kind.
 *
 * It is the first candidate whose latch this side still writes, asked of
 * `modOwnsLatch` rather than assumed, so a kind moving to the mod moves this
 * fixture onto the next one and changes no test that uses it. Every candidate
 * comes due by one Topic record arriving, which is what lets the caller stay
 * silent about which kind it got.
 *
 * Throws once no kind is left for this side to evaluate: a test that needs a
 * client-latched fire has no subject at that point, and saying so beats a
 * fixture that quietly never fires.
 */
export function firingAlarm(
  opts: { sustainSeconds?: number } = {},
): FiringAlarm {
  const found = candidates(opts.sustainSeconds ?? 0).find(
    (c) => !modOwnsLatch(c.trigger),
  );
  if (!found) {
    throw new Error(
      "firingAlarm: every candidate kind is latched by the mod, so no alarm fires on this side",
    );
  }
  return found;
}
