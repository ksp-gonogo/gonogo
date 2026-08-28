import {
  registerComponent,
  useCommand,
  useTelemetry,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Cluster,
  CommandButton,
  Panel,
  Stack,
  Text,
  Unit,
  usePanelDelay,
  WidgetSections,
} from "@ksp-gonogo/ui-kit";
import type {
  Rp1ComplexEntry,
  Rp1WarehouseItemEntry,
} from "../__generated__/contract";
import { current } from "../shared/current";
import { RP1 } from "../uplink";
// Side-effect import: hydrates these Topics' units at decode time. Here rather
// than left to the entry point's import order, because this file is the
// consumer that would silently receive bare numbers without it.
import "../topics";
// Side-effect imports: this widget's OWN two sections, bound into its slot the
// same way any Uplink's would be. Pulled in here rather than left to the
// package entry's import order, because a widget that lost its own sections to
// a module-ordering accident would look like a telemetry outage.
import "./Building";
import "./Warehouse";
import { VEHICLE_ASSEMBLY_SECTIONS } from "./slot";
import type { Vehicle } from "./vehicles";

/** Build another copy of a design. Must match `Rp1BuildCommands.RepeatCommand`. */
export const RP1_BUILD_REPEAT_COMMAND = "rp1.build.repeat";

type VehicleAssemblyConfig = Record<string, never>;

/**
 * Every craft RP-1's space centre is making or holding, across every launch
 * complex, and the actions that move them.
 *
 * <para><b>Why this is its own widget.</b> A launch complex shows up in three
 * places answering three different questions. The Space Center asks what
 * infrastructure the career has and lets an operator change it, so the rush
 * toggle, the staffing and the complex's own level live there. Launch Director
 * asks what can fly right now. This asks what is being built and how fast, and
 * a complex here is a GROUPING rather than a subject: the widget is
 * multi-complex by nature and shows every craft wherever it is being
 * integrated. None of the three is a view of the other two.</para>
 *
 * <para>So this widget shows the CONSEQUENCES of how the complexes are
 * administered and administers none of it. A card whose complex is rushing says
 * so, and one whose complex has nobody assigned says that instead of reporting
 * a stall an operator would go looking for a fault behind. What rushing costs,
 * and where the engineers go, stay next to the controls that decide them.</para>
 *
 * <para><b>The body is contributed, all of it.</b> Both lists arrive through
 * `rp1-vehicle-assembly.sections`, the same slot and the same registration call
 * an outside Uplink would use to add a section of its own. There is no private
 * route for first-party content, so the slot is adequate by construction rather
 * than by assertion: if the two lists can be built through it, so can anybody
 * else's.</para>
 *
 * <para><b>The balance is drawn once, here.</b> Every control in the body
 * spends or refunds career funds, and the repo rule is that a spend control is
 * never visible without a balance visible in the same widget. Drawing it on the
 * host is what lets each contributed section carry none: three sections each
 * with their own copy is the same rule satisfied three times in one widget,
 * which reads as a defect rather than as care.</para>
 */
export function VehicleAssembly() {
  const available = current(useTelemetry("rp1.available"));
  const warehouse = current(useTelemetry("rp1.warehouse"));
  const queue = current(useTelemetry("rp1.buildQueue"));
  const complexes = current(useTelemetry("rp1.complexes"));
  const career = current(useTelemetry("career.status"));

  // Unconditional and above the early return on purpose: a hook after it would
  // change count on the first frame RP-1 answers.
  const repeat = useCommand(RP1_BUILD_REPEAT_COMMAND);
  usePanelDelay(repeat);

  // Invisible on every install without RP-1, which is most of them.
  if (available !== true) {
    return null;
  }

  const built = warehouse ?? [];
  const building = queue ?? [];

  return (
    <Panel
      compactTitle={["VEHICLE ASSEMBLY", "ASSEMBLY"]}
      panelSections={false}
      panelTitle="VEHICLE ASSEMBLY"
    >
      <Stack gap="lg">
        {/* In the BODY rather than the header aside, and that is the funds rule
            deciding it rather than taste: a panel narrow enough that its title
            and its aside do not fit collapses the aside behind a chevron, so at
            five columns every spend control below was on screen with the
            balance shut in a disclosure. A body line wraps instead of
            hiding. */}
        <Text size="sm" title="Available funds" tone="muted">
          Funds <Unit value={career?.economy?.funds} />
        </Text>

        {built.length === 0 && building.length === 0 && (
          // A real answer, and one worth stating: an empty space centre and an
          // Uplink that is not reporting look identical if this is left out.
          <Text size="sm" tone="muted">
            None built and none on order.
          </Text>
        )}

        {/* Placed rather than left to `Panel`'s end-of-body default so the
            sections sit above the design-level control that acts on them. */}
        <WidgetSections />

        <RepeatBuilds
          designs={repeatableDesigns([built, building], complexes)}
          handle={repeat}
        />
      </Stack>
    </Panel>
  );
}

/** One design RP-1 can be asked for another copy of. */
type RepeatableDesign = Readonly<{
  /** The vehicle the command is addressed to, one existing copy of the design. */
  id: string;
  name: string;
  /** The name, with the complex the copy would be built at. */
  label: string;
  cost: Rp1WarehouseItemEntry["cost"];
}>;

/**
 * The repeat controls, one per design, under both lists.
 *
 * <para>On the host rather than in either section, because a design is not in
 * one list or the other: two Atlases, one flying-ready and one still
 * integrating, are one design and one control. A section that owned the buttons
 * for its own list would offer that design twice.</para>
 *
 * <para>Named for the design each one copies, because the name is the whole of
 * what distinguishes them and a strip of buttons all reading "Build another"
 * would be four presses an operator cannot tell apart.</para>
 *
 * <para>The heading says REPEAT rather than build. RP-1 has no command for
 * building a design the centre has never held, so a heading saying "build"
 * would promise the one thing this surface cannot do.</para>
 */
function RepeatBuilds({
  designs,
  handle,
}: Readonly<{
  designs: readonly RepeatableDesign[];
  handle: Parameters<typeof CommandButton>[0]["handle"];
}>) {
  if (designs.length === 0) {
    return null;
  }

  return (
    <Stack gap="xs">
      <Text size="xs" tone="muted">
        Repeat a build
      </Text>
      <Cluster gap="xs" justify="start" wrap>
        {designs.map((design) => (
          <CommandButton
            args={{ id: design.id }}
            aria-label={`Build another ${design.label}`}
            commandLabel={`Build another ${design.name}`}
            confirmAriaLabel={`Confirm building another ${design.label}`}
            confirmLabel={<SpendWording cost={design.cost} />}
            handle={handle}
            key={design.id}
            label={`Build another ${design.name}`}
            size="sm"
          />
        ))}
      </Cluster>
    </Stack>
  );
}

/**
 * Every design the centre could be asked for another copy of, once each.
 *
 * <para>Collapsed by complex and name, because that pair IS the design here:
 * two Atlases at LC-1 are the same craft file built twice, and offering a
 * control per copy asked an operator to choose between two presses that do the
 * same thing. The same craft at two complexes stays two controls, because the
 * complex decides how fast the copy is built and what it may weigh. The command
 * is still addressed to a vehicle id, so one existing copy is carried as the
 * target, and a finished one is preferred over a queued one only because the
 * warehouse list is read first.</para>
 *
 * <para>A vehicle RP-1 gave no id to is skipped, for the reason its card gives:
 * the name would have to be guessed back into an id. One with no NAME is
 * skipped too, because a button reading "Build another" naming nothing is not
 * something an operator could choose between.</para>
 */
function repeatableDesigns(
  lists: readonly (readonly Vehicle[])[],
  complexes: readonly Rp1ComplexEntry[] | undefined,
): readonly RepeatableDesign[] {
  const designs = new Map<string, RepeatableDesign>();
  for (const list of lists) {
    for (const item of list) {
      const id = item.id;
      const name = item.shipName;
      if (
        id === undefined ||
        id === null ||
        name === undefined ||
        name === null ||
        name === ""
      ) {
        continue;
      }
      const key = `${item.lcId ?? ""}:${name}`;
      if (designs.has(key)) {
        continue;
      }
      const complex = (complexes ?? []).find((c) => c.lcId === item.lcId);
      const where = complex?.name ?? null;
      designs.set(key, {
        cost: item.cost,
        id,
        label: where === null ? name : `${name} · ${where}`,
        name,
      });
    }
  }
  return [...designs.values()];
}

/**
 * What the confirm press commits to. The price is RP-1's stored figure rather
 * than the charge, and the difference is real: leaders and strategies move what
 * a purchase costs and only the mod can evaluate that, so this is an estimate
 * and the refusal that quotes the true charge is authoritative over it.
 */
function SpendWording({
  cost,
}: Readonly<{ cost: Rp1WarehouseItemEntry["cost"] }>) {
  return (
    <>
      Spend <Unit value={cost} />
    </>
  );
}

registerComponent<VehicleAssemblyConfig>({
  id: "rp1-vehicle-assembly",
  name: "Vehicle Assembly",
  description:
    "Every craft RP-1 is integrating or holding, across every launch " +
    "complex: what it costs, how far along it is, why its clock reads what " +
    "it reads, and the controls to roll one out, bring it back, scrap it or " +
    "order another copy.",
  tags: ["rp1", "career", "vehicles"],
  defaultSize: { w: 7, h: 16 },
  minSize: { w: 4, h: 6 },
  component: VehicleAssembly,
  openConfigOnAdd: false,
  dataRequirements: [
    "rp1.available",
    "rp1.warehouse",
    "rp1.buildQueue",
    "rp1.complexes",
    "rp1.pads",
    "rp1.operations",
    // The spend rule: every control in this widget moves career funds, so the
    // balance they are judged against has to be in it.
    "career.status",
  ],
  defaultConfig: {},
  actions: [],
  augmentSlots: [VEHICLE_ASSEMBLY_SECTIONS],
  pushable: true,
  owner: RP1,
});
