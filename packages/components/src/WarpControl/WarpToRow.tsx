import { type ParsedManeuverNode, useManeuverNodes } from "@ksp-gonogo/data";
import { useViewUt } from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { ToggleButton } from "@ksp-gonogo/ui";
import {
  Button,
  Cluster,
  Countdown,
  Disclosure,
  MissionDateField,
  ReadoutCaption,
  Stack,
  Unit,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import type { AlarmCreator } from "../shared/AlarmsLauncher";
import type { TimeTrigger } from "../TransferWindow/config";

type Target = "ut" | "node";

const LEAD_CHOICES_SECONDS = [30, 60, 300, 600] as const;

/** Seconds before the alarm's instant at which the warp steps down, matching the alarm modal's own default. */
const STEP_DOWN_SECONDS = 10;

/** The soonest node still ahead of the clock, which is the one an operator warps toward. */
function nextNode(
  nodes: readonly ParsedManeuverNode[],
  viewUt: ReturnType<typeof useViewUt>,
): ParsedManeuverNode | null {
  if (viewUt === undefined) return null;
  let best: ParsedManeuverNode | null = null;
  for (const node of nodes) {
    if (!value("ut", node.UT).greaterThan(viewUt)) continue;
    if (best === null || node.UT < best.UT) best = node;
  }
  return best;
}

/**
 * The warp-to targets: an instant chosen here becomes an ordinary time alarm,
 * and the alarm pipeline's own warp-kill drops the warp when it nears.
 */
export function WarpToRow({
  createAlarm,
}: Readonly<{ createAlarm: AlarmCreator<TimeTrigger> }>) {
  const viewUt = useViewUt();
  const nodes = useManeuverNodes();
  const [target, setTarget] = useState<Target>("ut");
  const [utTarget, setUtTarget] = useState<number | null>(null);
  const [leadSeconds, setLeadSeconds] = useState<number>(
    LEAD_CHOICES_SECONDS[1],
  );

  const node = nextNode(nodes, viewUt);
  const instant =
    target === "ut" ? utTarget : node === null ? null : node.UT - leadSeconds;
  const timeTo =
    instant === null || viewUt === undefined
      ? null
      : value("ut", instant).minus(viewUt);
  const armable = timeTo?.greaterThan(value("s", 0)) === true;

  const arm = () => {
    if (instant === null || !armable) return;
    createAlarm({
      name:
        target === "ut"
          ? "Warp to UT"
          : `Node minus ${writeQuantity(value("s", leadSeconds))}`,
      trigger: { kind: "time", ut: instant, leadSeconds: STEP_DOWN_SECONDS },
    });
  };

  return (
    <Disclosure
      variant="inline"
      asButton
      chevron={false}
      buttonSize="sm"
      panelHeight="auto"
      label={(open) => (open ? "Hide warp to" : "Warp to")}
    >
      <Stack gap="related-dense">
        <Cluster gap="related-packed" role="group" aria-label="Warp target">
          <ToggleButton
            size="sm"
            active={target === "ut"}
            onClick={() => setTarget("ut")}
          >
            UT
          </ToggleButton>
          <ToggleButton
            size="sm"
            active={target === "node"}
            onClick={() => setTarget("node")}
          >
            Node minus lead
          </ToggleButton>
        </Cluster>

        {target === "ut" ? (
          <MissionDateField
            label="Target instant"
            value={utTarget}
            onChange={setUtTarget}
          />
        ) : node === null ? (
          <ReadoutCaption>No maneuver node ahead</ReadoutCaption>
        ) : (
          <Cluster gap="related-packed" role="group" aria-label="Lead">
            {LEAD_CHOICES_SECONDS.map((seconds) => (
              <ToggleButton
                key={seconds}
                size="sm"
                active={leadSeconds === seconds}
                onClick={() => setLeadSeconds(seconds)}
              >
                <Unit value={value("s", seconds)} />
              </ToggleButton>
            ))}
          </Cluster>
        )}

        <Cluster gap="related-dense" wrap>
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={!armable}
            onClick={arm}
          >
            Set alarm
          </Button>
          {timeTo !== null && (
            <ReadoutCaption>
              {armable ? (
                <>
                  in <Countdown value={timeTo} />
                </>
              ) : (
                "Already past"
              )}
            </ReadoutCaption>
          )}
        </Cluster>
      </Stack>
    </Disclosure>
  );
}
