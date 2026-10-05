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
  UnitInput,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import type { AlarmCreator } from "../shared/AlarmsLauncher";
import type { TimeTrigger } from "../TransferWindow/config";

type Target = "for" | "node" | "ut";

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
  const [target, setTarget] = useState<Target>("for");
  const [forDuration, setForDuration] = useState(value("s", 0));
  const [utTarget, setUtTarget] = useState<number | null>(null);
  const [leadSeconds, setLeadSeconds] = useState<number>(
    LEAD_CHOICES_SECONDS[1],
  );

  const node = nextNode(nodes, viewUt);
  // A duration counts from the UT the widget is showing when it is confirmed, so the instant is read at the press and not fixed while the operator types.
  const instant =
    target === "for"
      ? viewUt === undefined || !forDuration.greaterThan(value("s", 0))
        ? null
        : viewUt.plus(forDuration).valueOf()
      : target === "ut"
        ? utTarget
        : node === null
          ? null
          : node.UT - leadSeconds;
  const timeTo =
    instant === null || viewUt === undefined
      ? null
      : value("ut", instant).minus(viewUt);
  const armable = timeTo?.greaterThan(value("s", 0)) === true;

  const arm = () => {
    if (instant === null || !armable) return;
    createAlarm({
      name:
        target === "for"
          ? `Warp for ${writeQuantity(forDuration)}`
          : target === "ut"
            ? "Warp to UT"
            : `${writeQuantity(value("s", leadSeconds))} before node`,
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
            active={target === "for"}
            onClick={() => setTarget("for")}
          >
            For
          </ToggleButton>
          <ToggleButton
            size="sm"
            active={target === "node"}
            onClick={() => setTarget("node")}
          >
            Before node
          </ToggleButton>
          <ToggleButton
            size="sm"
            active={target === "ut"}
            onClick={() => setTarget("ut")}
          >
            UT
          </ToggleButton>
        </Cluster>

        {target === "for" ? (
          <UnitInput
            label="Warp for"
            unit="s"
            rungs={["d", "h", "min"]}
            value={forDuration}
            onChange={setForDuration}
          />
        ) : target === "ut" ? (
          <MissionDateField
            label="Target instant"
            value={utTarget}
            onChange={setUtTarget}
          />
        ) : node === null ? (
          <ReadoutCaption>No maneuver node ahead</ReadoutCaption>
        ) : (
          <Cluster gap="related-packed" role="group" aria-label="Lead time">
            <ReadoutCaption>Lead</ReadoutCaption>
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
