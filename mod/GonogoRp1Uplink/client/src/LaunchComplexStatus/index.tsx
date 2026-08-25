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
  Unit,
} from "@ksp-gonogo/ui-kit";
import type {
  Rp1BuildItemEntry,
  Rp1WarehouseItemEntry,
} from "../__generated__/contract";
import { RP1 } from "../uplink";
// Side-effect import: hydrates these Topics' units at decode time and augments
// the payload map for their types. Here rather than left to the entry point's
// import order, because this file is the consumer that would silently receive
// bare numbers without it.
import "../topics";

/**
 * What the pre-launch panel is missing under RP-1, which is most of what
 * decides whether a launch works.
 *
 * <para>Stock's question is "can I afford this craft file". RP-1's is three
 * questions the panel cannot see: has this vehicle been BUILT, is the pad it is
 * aimed at free, and if not, how long until it is. A craft the editor can open
 * is not a vehicle that exists.</para>
 *
 * <para><b>This augment is advisory and says so.</b> It renders next to the
 * launch control; it does not gate it. gonogo is multi-screen and the command
 * is reachable from any surface that dispatches it, so a warning here is advice
 * to one client. The refusal belongs at the actuator, and that is the gate seam
 * rather than a widget.</para>
 */
export function LaunchComplexStatus({
  selectedSite,
  selectedShip,
}: Readonly<SlotProps<"launch-director.preflight">>) {
  const available = current(useTelemetry("rp1.available"));
  const pads = current(useTelemetry("rp1.pads"));
  const complexes = current(useTelemetry("rp1.complexes"));
  const queue = current(useTelemetry("rp1.buildQueue"));
  const warehouse = current(useTelemetry("rp1.warehouse"));

  // Invisible on every install without RP-1, which is most of them. An augment
  // that renders an empty section on a stock game is clutter that says nothing.
  if (available !== true) {
    return null;
  }

  const pad = (pads ?? []).find((p) => p.launchSiteName === selectedSite);
  const complex = pad
    ? (complexes ?? []).find((c) => c.lcId === pad.lcId)
    : undefined;
  const built = (warehouse ?? []).filter((v) => v.lcId === pad?.lcId);
  const building = (queue ?? []).filter((v) => v.lcId === pad?.lcId);

  return (
    <Section>
      <SectionTitle>RP-1 LAUNCH COMPLEX</SectionTitle>
      <Stack as="ul" gap="sm" style={LIST_STYLE}>
        <Row>
          <RowName>Pad</RowName>
          <Text>
            {pad?.name ?? NULL_DISPLAY}
            {complex ? ` · ${complex.name ?? NULL_DISPLAY}` : ""}
          </Text>
        </Row>

        <Row>
          <RowName>State</RowName>
          <PadState state={pad?.state} />
        </Row>

        <ShipReadiness
          selectedShip={selectedShip}
          built={built}
          building={building}
        />

        {building.length > 0 && (
          <Stack as="li" gap="xs">
            <RowName>Integrating</RowName>
            <Stack as="ul" gap="sm" style={LIST_STYLE}>
              {building.map((item) => (
                <BuildRow item={item} key={rowKey(item)} />
              ))}
            </Stack>
          </Stack>
        )}
      </Stack>
    </Section>
  );
}

/**
 * The pad's own answer to "may I launch from here". Anything but Free means the
 * launch will not work, and each arm says why in the operator's terms rather
 * than RP-1's.
 */
function PadState({ state }: Readonly<{ state: string | undefined }>) {
  if (state === undefined) {
    // No pad matched the selected site. Not the same as a pad that is busy, and
    // it must not read as one.
    return <Text>{NULL_DISPLAY} no RP-1 pad matches this site</Text>;
  }
  const blocked = state !== "Free";
  return (
    <Text>
      <Badge severity={blocked ? "caution" : "nominal"}>
        {state.toUpperCase()}
      </Badge>{" "}
      {PAD_STATE_MEANING[state] ?? "state not recognised"}
    </Text>
  );
}

/**
 * Whether the selected craft is a vehicle that EXISTS. Under RP-1 a craft file
 * and a launchable vehicle are different things, and the picker above shows the
 * first while the launch needs the second.
 */
function ShipReadiness({
  selectedShip,
  built,
  building,
}: Readonly<{
  selectedShip: string | null;
  built: readonly Rp1WarehouseItemEntry[];
  building: readonly Rp1BuildItemEntry[];
}>) {
  if (selectedShip === null) {
    return null;
  }
  const ready = built.some((v) => v.shipName === selectedShip);
  const inProgress = building.find((v) => v.shipName === selectedShip);

  if (ready) {
    return (
      <Row>
        <RowName>{selectedShip}</RowName>
        <Text>
          <Badge severity="nominal">BUILT</Badge> in the warehouse, ready to
          roll out
        </Text>
      </Row>
    );
  }
  if (inProgress !== undefined) {
    return (
      <Row>
        <RowName>{selectedShip}</RowName>
        <Text>
          <Badge severity="caution">INTEGRATING</Badge> still on the build list
        </Text>
      </Row>
    );
  }
  return (
    <Row>
      <RowName>{selectedShip}</RowName>
      <Text>
        <Badge severity="caution">NOT BUILT</Badge> no vehicle of this name at
        this complex
      </Text>
    </Row>
  );
}

/**
 * One vehicle being integrated. The rate and the ETA are separate readings and
 * are shown as separate facts: a null rate means RP-1 has not costed the
 * project yet, `stalled` means it is costed and going nowhere, and only the
 * second is worth an operator's attention.
 */
function BuildRow({ item }: Readonly<{ item: Rp1BuildItemEntry }>) {
  const ratio = magnitudeOf(item.progressRatio);
  return (
    <Stack as="li" gap="xs">
      <Stack as="ul" gap="xs" style={LIST_STYLE}>
        <Row>
          <RowName>{item.shipName ?? NULL_DISPLAY}</RowName>
          <Text>
            {item.timeLeftSeconds !== undefined &&
            item.timeLeftSeconds !== null ? (
              <Countdown value={item.timeLeftSeconds} />
            ) : item.stalled ? (
              <Badge severity="caution">STALLED</Badge>
            ) : (
              <>{NULL_DISPLAY} not costed yet</>
            )}
          </Text>
        </Row>
        <Row>
          <RowName>Progress</RowName>
          <Text>
            <Unit value={item.progress} /> / <Unit value={item.totalPoints} />
          </Text>
        </Row>
      </Stack>
      {/* Outside the list: a progressbar is not a list item, and axe is right
          to say so. */}
      {ratio !== null && (
        <ProgressBar
          ariaLabel={`Integration progress, ${item.shipName ?? "vehicle"}`}
          value={ratio * 100}
        />
      )}
    </Stack>
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

/** A stable key without inventing an identity the wire does not carry. */
function rowKey(item: Rp1BuildItemEntry): string {
  return `${item.lcId ?? ""}:${item.shipName ?? ""}`;
}

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
  augments: "launch-director.preflight",
  component: LaunchComplexStatus,
  owner: RP1,
});
