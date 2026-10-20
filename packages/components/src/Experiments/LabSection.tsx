import type { HeldGrade } from "@ksp-gonogo/sitrep-client";
import type { CommandReply } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Cluster,
  CommandButton,
  type CommandButtonHandle,
  Divider,
  HeldBadge,
  Inline,
  RowName,
  type Severity,
  Stack,
  Text,
  Tooltip,
} from "@ksp-gonogo/ui-kit";
import type { LabStatus } from "./parse";

function operationalBadge(isOperational: boolean | null): {
  severity: Severity;
  label: string;
} {
  if (isOperational === null) return { severity: "warn", label: "UNREAD" };
  if (isOperational) return { severity: "go", label: "OPERATIONAL" };
  return { severity: "nogo", label: "OFFLINE" };
}

/** The one sentence on a lab card for each run state: producing, switched on and idle, or off. */
const RUN_MEANING = {
  running: "Research is switched on and generating science",
  runningIdle: "Research is switched on, but not generating science right now",
  stopped: "Research is switched off",
} as const;

/** Mobile Processing Lab status. Renders nothing while loading or when the vessel carries no lab. */
export function LabSection({
  labs,
  heldGrade: labGrade,
  startCmd,
  stopCmd,
}: {
  labs: LabStatus[] | null;
  /** `science.lab` stopped arriving: every badge and count below is held. */
  heldGrade: HeldGrade | undefined;
  /** The lab start command. Omit for a read-only listing. */
  startCmd?: CommandButtonHandle<CommandReply<"science.lab.start">>;
  /** The lab stop command. Omit for a read-only listing. */
  stopCmd?: CommandButtonHandle<CommandReply<"science.lab.stop">>;
}) {
  if (labs === null || labs.length === 0) return null;
  return (
    <>
      <Stack>
        {labs.map((lab, i) => {
          const operational = operationalBadge(lab.isOperational);
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: no stable id on science.lab entries
            <Stack key={`${lab.partName}-${i}`}>
              <Cluster>
                <RowName>{lab.partName}</RowName>
                <Inline>
                  <Badge tone={operational.severity}>{operational.label}</Badge>
                  {lab.processingData === true && <Badge>PROCESSING</Badge>}
                  {labGrade !== undefined && (
                    <HeldBadge grade={labGrade} subject={lab.partName} />
                  )}
                </Inline>
              </Cluster>
              <Inline wrap>
                {lab.running === true && (
                  <Tooltip
                    text={
                      lab.producing === false
                        ? RUN_MEANING.runningIdle
                        : RUN_MEANING.running
                    }
                  >
                    <Badge tone={lab.producing === false ? "caution" : "go"}>
                      RUNNING
                    </Badge>
                  </Tooltip>
                )}
                {lab.running === false && (
                  <Tooltip text={RUN_MEANING.stopped}>
                    <Badge>STOPPED</Badge>
                  </Tooltip>
                )}
                {lab.partId !== null && lab.running === false && startCmd && (
                  <CommandButton
                    size="sm"
                    handle={startCmd}
                    args={{ partId: lab.partId }}
                    commandLabel={`Start research on ${lab.partName}`}
                    label="Start research"
                    pendingLabel="Starting..."
                  />
                )}
                {lab.partId !== null && lab.running === true && stopCmd && (
                  <CommandButton
                    size="sm"
                    handle={stopCmd}
                    args={{ partId: lab.partId }}
                    commandLabel={`Stop research on ${lab.partName}`}
                    label="Stop research"
                    pendingLabel="Stopping..."
                  />
                )}
                {lab.scientistCount !== null && (
                  <Text level="muted" size="xs">
                    {lab.scientistCount} scientist
                    {lab.scientistCount === 1 ? "" : "s"}
                  </Text>
                )}
                {lab.dataStored !== null && lab.dataStorage !== null && (
                  <Text level="muted" size="xs">
                    {lab.dataStored.toFixed(0)}/{lab.dataStorage.toFixed(0)}{" "}
                    data
                  </Text>
                )}
                {lab.valueModel !== null && lab.valueModel !== "stock" && (
                  <Text level="muted" size="xs">
                    {lab.valueModel} model
                  </Text>
                )}
              </Inline>
              {lab.running === true && lab.runIssue !== null && (
                <Text level="muted" size="xs">
                  {lab.runIssue}
                </Text>
              )}
            </Stack>
          );
        })}
      </Stack>
      <Divider space="related-dense" />
    </>
  );
}
