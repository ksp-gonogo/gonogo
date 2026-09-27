import type { StaleGrade } from "@ksp-gonogo/sitrep-client";
import {
  Badge,
  Cluster,
  Divider,
  formatStreamStatus,
  Inline,
  RowName,
  type Severity,
  Stack,
  severityFromStreamStatus,
  Text,
} from "@ksp-gonogo/ui-kit";
import type { LabStatus } from "./parse";

function operationalBadge(isOperational: boolean | null): {
  severity: Severity;
  label: string;
} {
  if (isOperational === null) return { severity: "warning", label: "UNREAD" };
  if (isOperational) return { severity: "nominal", label: "OPERATIONAL" };
  return { severity: "critical", label: "OFFLINE" };
}

/** Mobile Processing Lab status. Renders nothing while loading or when the vessel carries no lab. */
export function LabSection({
  labs,
  heldGrade: labGrade,
}: {
  labs: LabStatus[] | null;
  /** `science.lab` stopped arriving: every badge and count below is held. */
  heldGrade: StaleGrade | undefined;
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
                  <Badge severity={operational.severity}>
                    {operational.label}
                  </Badge>
                  {lab.processingData === true && <Badge>PROCESSING</Badge>}
                  {labGrade !== undefined && (
                    <Badge
                      severity={severityFromStreamStatus(labGrade)}
                      title={`${lab.partName}: lab state is no longer current`}
                    >
                      {formatStreamStatus(labGrade)}
                    </Badge>
                  )}
                </Inline>
              </Cluster>
              <Inline>
                {lab.scientistCount !== null && (
                  <Text tone="muted" size="xs">
                    {lab.scientistCount} scientist
                    {lab.scientistCount === 1 ? "" : "s"}
                  </Text>
                )}
                {lab.dataStored !== null && lab.dataStorage !== null && (
                  <Text tone="muted" size="xs">
                    {lab.dataStored.toFixed(0)}/{lab.dataStorage.toFixed(0)}{" "}
                    data
                  </Text>
                )}
              </Inline>
            </Stack>
          );
        })}
      </Stack>
      <Divider space="related-dense" />
    </>
  );
}
