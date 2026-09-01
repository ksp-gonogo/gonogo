import type { Reading, SlotProps } from "@ksp-gonogo/sitrep-sdk";
import { registerAugment, useTelemetry } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Countdown,
  magnitudeOf,
  NULL_DISPLAY,
  ProgressBar,
  Row,
  RowName,
  Section,
  SectionTitle,
  Stack,
  Text,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import type {
  Rp1OperationEntry,
  Rp1PadEntry,
  Rp1WarehouseItemEntry,
} from "../__generated__/contract";
import { RP1 } from "../uplink";
// Side-effect import: hydrates these Topics' units at decode time and augments
// the payload map for their types. Here rather than left to the entry point's
// import order, because this file is the consumer that would silently receive
// bare numbers without it.
import "../topics";

/**
 * What RP-1 knows about ONE pad, beside the pad's own row.
 *
 * <para>Stock's answer to "what is on this pad" is a vessel sitting at PRELAUNCH,
 * and RP-1's is three facts stock has no counterpart for: which launch complex
 * owns the pad, what the pad is currently doing, and which vehicle is standing
 * on it or on its way. The host reads the first from
 * <c>spaceCenter.launchSites</c>; the rest live here.</para>
 *
 * <para><b>Not the vehicle's build state.</b> Whether a vehicle has been
 * integrated is a fact about the vehicle and belongs where the vehicles are.
 * This section used to answer it, off the warehouse alone, and so called a
 * vehicle that had finished rolling out "BUILT, in the warehouse, ready to roll
 * out" while the operator could see it standing on the pad: a finished rollout
 * leaves the vehicle in the warehouse list and takes its operation away, and
 * nothing in a warehouse row says where the vehicle physically is.</para>
 *
 * <para><b>This augment is advisory and says so.</b> It renders next to the
 * launch control; it does not gate it. gonogo is multi-screen and the command
 * is reachable from any surface that dispatches it, so a warning here is advice
 * to one client. The refusal belongs at the actuator, and that is the gate seam
 * rather than a widget.</para>
 */
export function LaunchComplexStatus({
  siteName,
  expanded,
}: Readonly<SlotProps<"launch-director.pad">>) {
  const available = current(useTelemetry("rp1.available"));
  const pads = current(useTelemetry("rp1.pads"));
  const complexes = current(useTelemetry("rp1.complexes"));
  const operations = current(useTelemetry("rp1.operations"));
  const warehouse = current(useTelemetry("rp1.warehouse"));

  // Invisible on every install without RP-1, which is most of them. An augment
  // that renders an empty section on a stock game is clutter that says nothing.
  if (available !== true) {
    return null;
  }

  const pad = (pads ?? []).find((p) => p.launchSiteName === siteName);
  const operation = padOperation(operations, pad);
  const complex = pad
    ? (complexes ?? []).find((c) => c.lcId === pad.lcId)
    : undefined;

  if (pad === undefined) {
    // A stock launch site RP-1 does not model is not a busy pad, and must not
    // read as one: a launch aimed at it will not work, and that is worth one
    // line even though there is nothing else to say about it.
    return <Line>{NULL_DISPLAY} not an RP-1 launch complex</Line>;
  }

  const standing = standingOn(pad, operation, warehouse);

  if (!expanded) {
    return (
      <Line>
        <Badge severity={padSeverity(pad, operation)}>
          {padHeadline(pad, operation)}
        </Badge>{" "}
        {standing ??
          PAD_STATE_MEANING[pad.state ?? "None"] ??
          "state not recognised"}
      </Line>
    );
  }

  const ratio = operation ? magnitudeOf(operation.progressRatio) : null;
  return (
    <Section>
      <SectionTitle>LAUNCH COMPLEX</SectionTitle>
      <Stack as="ul" gap="sm" style={LIST_STYLE}>
        <Row>
          <RowName>Complex</RowName>
          <Text>
            {complex?.name ?? NULL_DISPLAY}
            {complex?.lcType ? ` · ${complex.lcType}` : ""}
          </Text>
        </Row>

        <Row>
          <RowName>State</RowName>
          <Text>
            <Badge severity={padSeverity(pad, operation)}>
              {padHeadline(pad, operation)}
            </Badge>{" "}
            {PAD_STATE_MEANING[pad.state ?? "None"] ?? "state not recognised"}
          </Text>
        </Row>

        <Row>
          <RowName>On the pad</RowName>
          <Text>{standing ?? "nothing standing on it"}</Text>
        </Row>

        {operation !== undefined && (
          <Row>
            <RowName>
              {OPERATION_VERB[operation.type ?? ""] ?? "Operation"}
            </RowName>
            <Text>
              {operation.timeLeftSeconds !== undefined &&
              operation.timeLeftSeconds !== null ? (
                <Countdown value={operation.timeLeftSeconds} />
              ) : operation.stalled ? (
                <Badge severity="caution">STALLED</Badge>
              ) : (
                <>{NULL_DISPLAY} not costed yet</>
              )}
            </Text>
          </Row>
        )}
      </Stack>
      {/* Outside the list: a progressbar is not a list item, and axe is right
          to say so. */}
      {ratio !== null && (
        <ProgressBar
          ariaLabel={`Pad operation progress, ${pad.name ?? "pad"}`}
          value={ratio * 100}
        />
      )}
    </Section>
  );
}

/**
 * The rollout, rollback or reconditioning this pad is under, joined on the pad's
 * NAME: <c>Rp1OperationEntry.LaunchPadId</c> carries that rather than the pad's
 * own id. A pad with no name comes back as not under any operation, which is the
 * safe direction: the row then falls through to the pad's own state.
 */
function padOperation(
  operations: readonly Rp1OperationEntry[] | undefined,
  pad: Rp1PadEntry | undefined,
): Rp1OperationEntry | undefined {
  const name = pad?.name;
  if (name === undefined || name === null) return undefined;
  return (operations ?? []).find(
    (operation) =>
      operation.launchPadId === name &&
      operation.type !== undefined &&
      operation.type !== null &&
      operation.type !== "None",
  );
}

/**
 * Which vehicle this pad is holding or receiving, in the operator's words, or
 * undefined when the pad reports nothing on it.
 *
 * <para>A vehicle ALREADY at the launch site has no operation left: RP-1 answers
 * that separately through <c>LCLaunchPad.HasVesselWaitingToBeLaunched</c>, which
 * is <c>hasVesselWaiting</c> here. Null there means the question could not be
 * answered, which is not the same as no vehicle and does not collapse into
 * it.</para>
 */
function standingOn(
  pad: Rp1PadEntry,
  operation: Rp1OperationEntry | undefined,
  warehouse: readonly Rp1WarehouseItemEntry[] | undefined,
): string | undefined {
  if (pad.hasVesselWaiting === true) {
    return `${pad.waitingVesselName ?? NULL_DISPLAY} is standing on it`;
  }
  if (operation !== undefined) {
    const vehicle = (warehouse ?? []).find(
      (item) =>
        item.shipId !== undefined &&
        item.shipId !== null &&
        item.shipId === operation.associatedVesselId,
    );
    const name = vehicle?.shipName ?? NULL_DISPLAY;
    if (operation.type === "Rollout") return `${name} is on its way out`;
    if (operation.type === "Rollback") return `${name} is coming off`;
    return undefined;
  }
  if (pad.hasVesselWaiting === undefined || pad.hasVesselWaiting === null) {
    return `${NULL_DISPLAY} RP-1 did not say whether a vehicle is waiting`;
  }
  return undefined;
}

/** The word the row leads with: what is happening beats what the state field says. */
function padHeadline(
  pad: Rp1PadEntry,
  operation: Rp1OperationEntry | undefined,
): string {
  if (pad.hasVesselWaiting === true) return "AT PAD";
  if (operation?.type === "Rollout") return "ROLLING OUT";
  if (operation?.type === "Rollback") return "ROLLING BACK";
  return (pad.state ?? "None").toUpperCase();
}

/** Nominal only for a pad a launch would actually work from. */
function padSeverity(
  pad: Rp1PadEntry,
  operation: Rp1OperationEntry | undefined,
): "nominal" | "caution" {
  if (pad.hasVesselWaiting === true) return "nominal";
  if (operation !== undefined) return "caution";
  return pad.state === "Free" ? "nominal" : "caution";
}

/**
 * One line in a collapsed pad row, where a whole Section would be noise. Quiet
 * and small on purpose: every pad row carries this section, so a space centre
 * with six pads has six of these lines under a list the operator is scanning.
 */
function Line({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <Text size="xs" tone="muted">
      {children}
    </Text>
  );
}

/**
 * A Row renders an `<li>`, so its rows need list semantics around them or a
 * screen reader is handed an orphan list item. The same reset four first-party
 * widgets carry; a shared primitive for it would be a reasonable ui-kit
 * addition.
 */
const LIST_STYLE = { listStyle: "none", margin: 0, padding: 0 } as const;

/** What each RP-1 pad state means for the launch the operator is about to fire. */
const PAD_STATE_MEANING: Readonly<Record<string, string>> = {
  Free: "clear for launch",
  Rollout: "a vehicle is rolling out to this pad",
  Rollback: "a vehicle is coming off this pad",
  Reconditioning: "being made good after the last launch",
  Nonoperational: "not operational",
  Destroyed: "destroyed, and needs repair before it can be used",
  None: "no state reported",
};

/**
 * How each of RP-1's `RolloutReconType` arms is labelled beside its countdown.
 * Seven arms, not the five a KCT-shaped client would map: the two airlaunch ones
 * are real and a table missing them silently drops the row.
 */
const OPERATION_VERB: Readonly<Record<string, string>> = {
  Rollout: "Rollout",
  Rollback: "Rollback",
  Reconditioning: "Reconditioning",
  Recovery: "Recovery",
  AirlaunchMount: "Mounting",
  AirlaunchUnmount: "Unmounting",
};

/**
 * The value where one is current. A ground fact read while the link is down is
 * still the last thing the space centre said, and these channels are TrueNow,
 * so a reckonable reading is as good as an observed one here.
 */
function current<T>(reading: Reading<T>): T | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "reckonable") return reading.reckoned.value;
  return undefined;
}

registerAugment({
  id: "rp1-launch-complex-status",
  augments: "launch-director.pad",
  component: LaunchComplexStatus,
  owner: RP1,
});
