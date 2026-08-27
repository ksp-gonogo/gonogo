import type { Reading } from "@ksp-gonogo/sitrep-sdk";
import {
  registerAugment,
  useCommand,
  useTelemetry,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  CommandButton,
  Countdown,
  NULL_DISPLAY,
  Row,
  RowName,
  Section,
  SectionTitle,
  Stack,
  Text,
  Unit,
  usePanelDelay,
} from "@ksp-gonogo/ui-kit";
import type {
  Rp1BuildItemEntry,
  Rp1ComplexEntry,
  Rp1WarehouseItemEntry,
} from "../__generated__/contract";
import { RP1 } from "../uplink";
// Side-effect import: hydrates these Topics' units at decode time. Here rather
// than left to the entry point's import order, because this file is the consumer
// that would silently receive bare numbers without it.
import "../topics";

/** The command this widget exists for. Must match `Rp1BuildCommands.RepeatCommand`. */
export const RP1_BUILD_REPEAT_COMMAND = "rp1.build.repeat";

/**
 * Every vehicle RP-1's space centre holds, and the one action an operator
 * performs on them more than any other: build another.
 *
 * <para><b>Why this is the action worth a control.</b> Under RP-1 a rocket is a
 * DESIGN that a launch complex integrates into an article, and the career loop
 * is to design once and fly the same vehicle many times. So "another one of
 * these" is not an edge case, it is the most repeated decision in the game, and
 * until this widget existed the whole RP-1 surface was read-only: an operator
 * could watch a complex integrate and could not ask it to start anything.</para>
 *
 * <para><b>Both lists, one section.</b> A finished vehicle in the warehouse and
 * one still integrating are different states of the same question, and RP-1's
 * own window draws the same Duplicate button on both. The warehouse comes first
 * because a design worth repeating is usually one that finished.</para>
 *
 * <para>The funds balance sits at the top because every control below it spends:
 * an operator deciding whether to start another should not have to look at a
 * different widget to see what is left. It is the balance the mod's own
 * affordability check will be run against, so a refusal here quotes the same
 * number the operator is reading.</para>
 */
export function KscVehicles() {
  const available = current(useTelemetry("rp1.available"));
  const warehouse = current(useTelemetry("rp1.warehouse"));
  const queue = current(useTelemetry("rp1.buildQueue"));
  const complexes = current(useTelemetry("rp1.complexes"));
  const career = current(useTelemetry("career.status"));

  // Unconditional, and above the early return on purpose: a hook after it would
  // change count on the first frame RP-1 answers.
  const repeat = useCommand(RP1_BUILD_REPEAT_COMMAND);
  usePanelDelay(repeat);

  // Invisible on every install without RP-1, which is most of them.
  if (available !== true) {
    return null;
  }

  const built = warehouse ?? [];
  const building = queue ?? [];
  // Only worth naming a complex when the centre has more than one, the same rule
  // KscConstruction applies to centres.
  const nameComplex = (complexes ?? []).length > 1;

  return (
    <Section>
      <SectionTitle>RP-1 VEHICLES</SectionTitle>
      <Stack as="ul" gap="sm" style={LIST_STYLE}>
        <Row>
          <RowName>Funds</RowName>
          <Text>
            <Unit value={career?.economy?.funds} />
          </Text>
        </Row>

        {built.length === 0 && building.length === 0 ? (
          <Row>
            <RowName>Vehicles</RowName>
            {/* A real answer, and one worth stating: an empty space centre and
                an Uplink that is not reporting look identical if this row is
                simply left out. */}
            <Text>none built and none on order</Text>
          </Row>
        ) : (
          <>
            {built.map((item) => (
              <VehicleRow
                complexName={complexName(complexes, item.lcId, nameComplex)}
                handle={repeat}
                item={item}
                key={rowKey(item)}
                state={<Badge severity="nominal">BUILT</Badge>}
              />
            ))}
            {building.map((item) => (
              <VehicleRow
                complexName={complexName(complexes, item.lcId, nameComplex)}
                handle={repeat}
                item={item}
                key={rowKey(item)}
                state={<Integrating item={item} />}
              />
            ))}
          </>
        )}
      </Stack>
    </Section>
  );
}

/**
 * One vehicle, and its repeat control.
 *
 * <para>The control ARMS before it dispatches, because it spends career funds
 * and the ui-kit rule for anything that does is that one press must not commit
 * it. The price is on the confirm wording rather than the resting one: an
 * operator scanning a list wants the names, and an operator about to spend wants
 * the number.</para>
 */
function VehicleRow({
  item,
  complexName: complex,
  state,
  handle,
}: Readonly<{
  item: Rp1BuildItemEntry | Rp1WarehouseItemEntry;
  complexName: string | null;
  state: React.ReactNode;
  handle: Parameters<typeof CommandButton>[0]["handle"];
}>) {
  const name = item.shipName ?? NULL_DISPLAY;
  const label = complex === null ? name : `${name} · ${complex}`;

  return (
    <Stack as="li" gap="xs">
      {/* A Row renders an <li>, so these need their own list around them or a
          screen reader is handed orphan list items inside this one. */}
      <Stack as="ul" gap="xs" style={LIST_STYLE}>
        <Row>
          <RowName>{label}</RowName>
          <Text>{state}</Text>
        </Row>
        <Row>
          <RowName>Cost</RowName>
          <Text>
            <Unit value={item.cost} />
          </Text>
        </Row>
        <Row>
          <RowName>Build another</RowName>
          <Text>
            {item.id === undefined || item.id === null ? (
              // Readable and not commandable, and it says which. RP-1 stamps an
              // id on every vehicle it creates, so a row without one came out of
              // a save written before it did; guessing a target from the name
              // would pick the wrong one of two vehicles that share it.
              <>{NULL_DISPLAY} RP-1 has no id for this vehicle</>
            ) : (
              <CommandButton
                args={{ id: item.id }}
                aria-label={`Build another ${label}`}
                commandLabel={`Build another ${name}`}
                confirmAriaLabel={`Confirm building another ${label}`}
                confirmLabel={<ConfirmWording item={item} />}
                handle={handle}
                label="Build"
                size="sm"
              />
            )}
          </Text>
        </Row>
      </Stack>
    </Stack>
  );
}

/**
 * What the confirm press commits to. The price is RP-1's stored figure rather
 * than the charge, and the difference is real: leaders and strategies move what
 * a purchase costs and only the mod can evaluate that, so this is an estimate
 * and the refusal that quotes the true charge is authoritative over it.
 */
function ConfirmWording({
  item,
}: Readonly<{ item: Rp1BuildItemEntry | Rp1WarehouseItemEntry }>) {
  return (
    <>
      Spend <Unit value={item.cost} />
    </>
  );
}

/**
 * How far along a vehicle still on the build list is. Three states rather than
 * two, the same split LaunchComplexStatus draws: an ETA, a rate RP-1 resolved at
 * zero, and a project RP-1 has not costed yet. The last is not a stall.
 */
function Integrating({ item }: Readonly<{ item: Rp1BuildItemEntry }>) {
  if (item.timeLeftSeconds !== undefined && item.timeLeftSeconds !== null) {
    return (
      <>
        <Badge severity="caution">INTEGRATING</Badge>{" "}
        <Countdown value={item.timeLeftSeconds} />
      </>
    );
  }
  if (item.stalled === true) {
    return <Badge severity="caution">STALLED</Badge>;
  }
  return (
    <>
      <Badge severity="caution">INTEGRATING</Badge> {NULL_DISPLAY} not costed
      yet
    </>
  );
}

/** The complex's own name, or null when there is only one and naming it says nothing. */
function complexName(
  complexes: readonly Rp1ComplexEntry[] | undefined,
  lcId: string | undefined | null,
  wanted: boolean,
): string | null {
  if (!wanted || lcId === undefined || lcId === null) {
    return null;
  }
  return (complexes ?? []).find((c) => c.lcId === lcId)?.name ?? null;
}

/**
 * A stable key. RP-1's own id where there is one, because two vehicles of the
 * same design at the same complex are the point of this widget and would
 * otherwise share a key.
 */
function rowKey(item: Rp1BuildItemEntry | Rp1WarehouseItemEntry): string {
  return item.id ?? `${item.lcId ?? ""}:${item.shipName ?? ""}`;
}

/**
 * A Row renders an `<li>`, so its rows need list semantics around them; see
 * LaunchComplexStatus for the same reset and why it is inline.
 */
const LIST_STYLE = { listStyle: "none", margin: 0, padding: 0 } as const;

/** The value where one is current; see LaunchComplexStatus for why reckonable counts. */
function current<T>(reading: Reading<T>): T | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "reckonable") return reading.reckoned.value;
  return undefined;
}

registerAugment({
  id: "rp1-ksc-vehicles",
  augments: "space-center-status.sections",
  component: KscVehicles,
  owner: RP1,
});
