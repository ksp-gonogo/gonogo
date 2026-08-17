import { getComponent } from "@ksp-gonogo/core";
import { describe, expect, it } from "vitest";
import "@ksp-gonogo/components";
import { alarmMatchesWidget } from "./AlarmStatusBridge";
import type { Alarm } from "./types";

/**
 * The ledger of what each migrated widget's `dataRequirements` used to say,
 * and the assertion that an alarm saved against the old key still finds the
 * widget after the swap.
 *
 * This exists because the swap looked behaviour-preserving and was not. Both
 * consumers of `dataRequirements` matched by string equality against a legacy
 * key, so replacing that key with the topic the widget actually reads detached
 * every alarm from it, with nothing failing anywhere. An operator's saved alarm
 * simply stopped lighting the panel it was about.
 *
 * Alarm keys are user data: they come from a picker over the legacy catalog and
 * live in localStorage, so they outlive any given widget's declaration and
 * cannot be migrated by editing a widget. Every slice of the vocabulary
 * migration therefore adds its widgets here, and this is the file that fails if
 * a slice quietly drops one.
 *
 * `expectMatch: false` is for a key the widget never actually rendered. Those
 * are deliberate and each carries its reason: attribution restored to what the
 * widget draws is the point of the exercise, and preserving a wrong pointer
 * would preserve the bug.
 */
interface MigratedWidget {
  /** Registered component id. */
  id: string;
  /** Legacy keys this widget used to declare, and whether an alarm on each
   *  should still be attributed to it. */
  legacyKeys: ReadonlyArray<{
    key: string;
    expectMatch: boolean;
    why?: string;
  }>;
}

const MIGRATED: readonly MigratedWidget[] = [
  {
    id: "astronaut-complex",
    legacyKeys: [{ key: "career.funds", expectMatch: true }],
  },
  {
    id: "objectives",
    legacyKeys: [{ key: "contracts.active", expectMatch: true }],
  },
  {
    id: "system-view",
    legacyKeys: [
      {
        key: "b.number",
        expectMatch: false,
        why: "the widget walks the body array and renders no count, so a body-count alarm was never about it",
      },
    ],
  },
];

function thresholdAlarm(dataKey: string): Alarm {
  return {
    id: `alarm-${dataKey}`,
    name: dataKey,
    state: "firing",
    createdBy: "main",
    createdAt: 0,
    trigger: {
      kind: "threshold",
      dataKey,
      op: ">",
      value: 0,
      sustainSeconds: 0,
    },
  };
}

describe("migrated widgets keep the alarms saved against their old keys", () => {
  for (const widget of MIGRATED) {
    describe(widget.id, () => {
      it("is registered and declares no legacy key any more", () => {
        const def = getComponent(widget.id);
        expect(def, `${widget.id} is not registered`).toBeDefined();
        const stillLegacy = (def?.dataRequirements ?? []).filter(
          (requirement) =>
            widget.legacyKeys.some(({ key }) => key === requirement),
        );
        expect(stillLegacy).toEqual([]);
      });

      for (const { key, expectMatch, why } of widget.legacyKeys) {
        it(`${expectMatch ? "still attributes" : "no longer attributes"} an alarm on ${key}${why ? `, because ${why}` : ""}`, () => {
          const def = getComponent(widget.id);
          expect(
            alarmMatchesWidget(thresholdAlarm(key), def?.dataRequirements),
          ).toBe(expectMatch);
        });
      }
    });
  }
});
