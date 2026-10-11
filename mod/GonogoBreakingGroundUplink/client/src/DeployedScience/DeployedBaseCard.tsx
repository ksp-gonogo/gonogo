import type { Reading, Value } from "@ksp-gonogo/sitrep-sdk";
import { AugmentSlot, combineReadings, value } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Box,
  Cluster,
  HeldBadge,
  heldGradeOf,
  Meter,
  Stack,
  Text,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { DeployedBase } from "./parseBases";
import { POWER_LABEL, POWER_TONE, powerBalance, powerState } from "./power";

const XS2_STYLE = { fontSize: "var(--font-size-caption)" } as const;

/** A completion fraction as a percentage, exactly as current as `deployed.bases` is. */
function progressPercentReading(
  source: Reading<unknown>,
  fraction: number,
): Reading<Value<"%">> {
  return combineReadings([source], () => value("%", fraction * 100));
}

/** The same completion as the 0..1 fraction a meter's bar is drawn from. */
function progressRatioReading(
  source: Reading<unknown>,
  fraction: number,
): Reading<Value<"ratio">> {
  return combineReadings([source], () => value("ratio", fraction));
}

const titleCase = (name: string) =>
  name.charAt(0) + name.slice(1).toLowerCase().replace(/_/g, " ");

/** Biome and situation of the cluster, plus a note when it is known not to sit on the ground. */
function siteLine(base: DeployedBase): string | null {
  const parts = [
    base.biome,
    base.situation === null ? null : titleCase(base.situation),
    base.deployedOnGround === false ? "not on the ground" : null,
  ].filter((p): p is string => p !== null && p !== "");
  return parts.length === 0 ? null : parts.join(" · ");
}

/** One base's card: its power state and balance, then a meter per experiment, each figure carrying the roster's currency. */
export function DeployedBaseCard({
  base,
  basesReading,
}: {
  base: DeployedBase;
  basesReading: Reading<unknown>;
}) {
  const state = powerState(base);
  // Power and collection states are drawn as words, so a roster that stopped arriving says so beside them.
  const heldGrade = heldGradeOf(basesReading);
  return (
    <Box
      bordered
      radius="regular"
      style={{
        padding: "var(--inset-surface)",
        borderColor: "var(--color-surface-raised)",
      }}
    >
      <Stack>
        <Cluster style={{ gap: "var(--gap-related)" }}>
          <Text size="sm" style={{ fontWeight: 600 }}>
            {base.body || "Surface base"}
          </Text>
          <Badge tone={POWER_TONE[state]} data-tone={POWER_TONE[state]} live>
            {POWER_LABEL[state]}
          </Badge>
          {heldGrade !== undefined && (
            <HeldBadge grade={heldGrade} subject="Deployed bases" size="sm" />
          )}
        </Cluster>
        {siteLine(base) && (
          <Text level="muted" style={XS2_STYLE}>
            {siteLine(base)}
          </Text>
        )}
        <Text level="muted" style={XS2_STYLE}>
          {/* Breaking Ground power units, not electric charge. */}
          {powerBalance(base) ?? "Power unknown"}
          {base.experiments.length > 0 && (
            <Text level="faint" style={XS2_STYLE}>
              {" "}
              · {base.experiments.length} exp
            </Text>
          )}
        </Text>

        {base.experiments.map((exp) => (
          <Stack key={`${base.id}-${exp.partId}`}>
            {/* No completion draws the absent form, not an empty track. */}
            <Meter
              label={exp.name}
              tone="go"
              value={
                exp.progress === null
                  ? null
                  : progressRatioReading(basesReading, exp.progress)
              }
              valueLabelNode={
                exp.progress === null ? undefined : (
                  <>
                    <Unit
                      value={progressPercentReading(basesReading, exp.progress)}
                      decimals={0}
                    />
                    {exp.collecting === true && (
                      <Text tone="go" style={XS2_STYLE}>
                        {" "}
                        ● collecting
                      </Text>
                    )}
                  </>
                )
              }
            />
            <AugmentSlot
              name="deployed-science.experiment"
              props={{ experiment: exp, body: base.body, held: basesReading }}
            />
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}
