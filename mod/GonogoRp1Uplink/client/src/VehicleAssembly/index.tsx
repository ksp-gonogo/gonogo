import { registerComponent, useTelemetry } from "@ksp-gonogo/sitrep-sdk";
import { Panel, Section, Text, Unit } from "@ksp-gonogo/ui-kit";
import type { Rp1ComplexEntry } from "../__generated__/contract";
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
import "./BuildCost";
import "./Building";
import "./Buildable";
import "./Tooling";
import "./Warehouse";
import { VEHICLE_ASSEMBLY_SECTIONS } from "./slot";

/**
 * Build another copy of a design RP-1 already holds. Must match
 * `Rp1BuildCommands.RepeatCommand`.
 *
 * <para><b>Exported and still without a control.</b> It COPIES something the
 * centre already has, so a button for it can order a second Atlas and can never
 * order a first one. The general case now exists as `rp1.build.start`, which
 * starts any saved craft at any complex that will take it, and a repeat is that
 * command run again on the same craft file: a second button doing the same job
 * from a different address would be two ways to order one thing. The name stays
 * because the command stays live on the mod side.</para>
 */
export const RP1_BUILD_REPEAT_COMMAND = "rp1.build.repeat";

type VehicleAssemblyConfig = Record<string, never>;

/**
 * Every craft RP-1's space centre is making, holding or could start, across
 * every launch complex, and the actions that move them.
 *
 * <para><b>Purely construction and rollout for vehicles.</b> A launch complex
 * shows up in three widgets answering three different questions, and the
 * division is settled. The Space Center holds the career's INFRASTRUCTURE: the
 * global buildings and their upgrades, the space centres, the launch complexes
 * inside each, and the management of those complexes, which is who is assigned
 * where, what each level costs, and the choice to rush. Launch Director asks
 * what can fly right now. This asks what is being built and how fast. A complex
 * here is where work is happening rather than a thing being administered.</para>
 *
 * <para>So this widget administers NOTHING: no rush toggle, no staff
 * assignment, no complex level, no payroll. It shows the CONSEQUENCES of those
 * decisions, because they are what its clocks are made of. A card whose complex
 * is rushing says so, and one whose complex has nobody assigned says that
 * instead of reporting a stall an operator would go looking for a fault behind.
 * Both are read-only, and the controls for them are one widget away.</para>
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
 *
 * <para><b>Starting a build lives in a section like the others.</b> It reads
 * `rp1.buildable`, which is the save's craft files measured against every
 * complex, and dispatches `rp1.build.start`. See
 * {@link RP1_BUILD_REPEAT_COMMAND} for why RP-1's own repeat command still gets
 * no control of its own.</para>
 */
export function VehicleAssembly() {
  const available = current(useTelemetry("rp1.available"));
  const warehouse = current(useTelemetry("rp1.warehouse"));
  const queue = current(useTelemetry("rp1.buildQueue"));
  const complexes = current(useTelemetry("rp1.complexes"));
  const career = current(useTelemetry("career.status"));

  // Invisible on every install without RP-1, which is most of them.
  if (available !== true) {
    return null;
  }

  return (
    <Panel
      compactTitle={["VEHICLE ASSEMBLY", "ASSEMBLY"]}
      panelTitle="VEHICLE ASSEMBLY"
      /* The host's own body is three caption lines; the readings come from the
         Uplink sections Panel now mounts INSIDE the section grid, so they flow
         into columns in a landscape tile instead of stacking under this. That
         is also why the hand-placed `WidgetSections` and the
         `panelSections={false}` that went with it are gone: end-of-body is
         where Panel puts it anyway. */
      sections={
        <Section full gap="lg">
          {/* In the BODY rather than the header aside, and that is the funds rule
            deciding it rather than taste: a panel narrow enough that its title
            and its aside do not fit collapses the aside behind a chevron, so at
            five columns every spend control below was on screen with the
            balance shut in a disclosure. A body line wraps instead of
            hiding. */}
          <Text size="sm" title="Available funds" tone="muted">
            Funds <Unit value={career?.economy?.funds} />
          </Text>

          {/* The unlock credit, where the career has one, drawn BESIDE the funds
              and never folded into them.

              Its own contract says why: it is a prepaid allowance the money
              model spends before funds on the purchases it covers, so part of a
              price may already be paid and the funds balance alone is not an
              affordability test. Tooling this vehicle is exactly such a
              purchase, and so is unlocking its parts. The split between the two
              pools is the producer's to make at transaction time, so both
              balances are shown and neither is derived from the other here.

              ABSENT on stock, which has no such pool, and absent is silence:
              a zero would claim the career has an empty allowance rather than
              no allowance. */}
          {career?.economy?.unlockCredit != null && (
            <Text
              size="sm"
              title="Prepaid credit, spent before funds on the purchases it covers"
              tone="muted"
            >
              Unlock credit <Unit value={career.economy.unlockCredit} />
            </Text>
          )}

          <ComplexKey complexes={complexes ?? []} />

          {warehouse === undefined && queue === undefined && (
            /* Only the UNREADABLE case says anything. A space centre with nothing
             built renders nothing, because a sentence announcing that a list is
             empty is not a reading, it is the widget talking about itself.

             This used to fire on `built.length === 0 && building.length === 0`
             and carried a comment claiming it distinguished an empty centre from
             an Uplink that is not reporting. It could not: `warehouse ?? []`
             turns an absent payload into an empty array one line above, so both
             states reached the same sentence. The distinction is real and worth
             keeping, so it is made on the ABSENCE itself rather than on a count
             that cannot see it. */
            <Text size="sm" tone="muted">
              No reading from the build queue.
            </Text>
          )}
        </Section>
      }
    />
  );
}

/**
 * What a launch complex IS, and which space centre it belongs to.
 *
 * <para>The cards below are tagged `LC-1`, and an operator who has not read
 * RP-1's own documentation has no way to know from that tag whether LC-1 is a
 * building, a pad, a site or a queue. RP-1's own words for the hierarchy are
 * nowhere on the wire: `kscName` and `name` are two strings and nothing says
 * one contains the other. This line says it once, at the top, so every tag
 * below it can stay a tag.</para>
 *
 * <para>The nesting is: a career has ONE set of facilities (the VAB, the SPH,
 * Mission Control), several space centres, and each centre holds launch
 * complexes, each of which holds pads. This names the middle two, because those
 * are the two the cards are tagged with; the pads name themselves on the
 * rollout controls that send a vehicle to one.</para>
 *
 * <para>Drawn as a sentence rather than as a tree, because it is one fact and a
 * tree of two levels is a diagram of nothing. Absent entirely when RP-1 has not
 * sent the complexes: a heading over nothing says less than no heading.</para>
 */
function ComplexKey({
  complexes,
}: Readonly<{ complexes: readonly Rp1ComplexEntry[] }>) {
  const centres = groupByCentre(complexes);
  if (centres.length === 0) {
    return null;
  }

  return (
    <Text size="xs" tone="muted">
      Launch complexes:{" "}
      {centres.map((centre, index) => (
        <span key={centre.name}>
          {index > 0 ? "; " : null}
          {centre.complexes.join(", ")} at {centre.name}
        </span>
      ))}
    </Text>
  );
}

/** One space centre and the launch complexes standing at it. */
type Centre = Readonly<{ name: string; complexes: readonly string[] }>;

/**
 * The complexes gathered under the centre each one stands at, in the order RP-1
 * listed them.
 *
 * <para>A complex RP-1 gave no name to is skipped rather than drawn as a dash:
 * this line exists to let an operator match a card's tag to a place, and a dash
 * matches no tag. A complex with no CENTRE is gathered under a centre named for
 * what is known about it, because dropping it would leave a tag on a card with
 * nothing up here to match.</para>
 */
function groupByCentre(complexes: readonly Rp1ComplexEntry[]): Centre[] {
  const byCentre = new Map<string, string[]>();
  for (const complex of complexes) {
    const name = complex.name;
    if (name === undefined || name === null || name === "") {
      continue;
    }
    const centre =
      complex.kscDisplayName ?? complex.kscName ?? "an unnamed space centre";
    const held = byCentre.get(centre);
    if (held === undefined) {
      byCentre.set(centre, [name]);
    } else {
      held.push(name);
    }
  }
  return [...byCentre].map(([name, held]) => ({ complexes: held, name }));
}

registerComponent<VehicleAssemblyConfig>({
  id: "rp1-vehicle-assembly",
  name: "Vehicle Assembly",
  description:
    "Every craft RP-1 is integrating, holding or could start, across every " +
    "launch complex at every space centre: what it costs, how far along it " +
    "is, why its clock reads what it reads, and the controls to start a " +
    "build, roll one out, bring it back or scrap it.",
  tags: ["rp1", "career", "vehicles"],
  defaultSize: { w: 7, h: 16 },
  minSize: { w: 4, h: 6 },
  component: VehicleAssembly,
  openConfigOnAdd: false,
  dataRequirements: [
    "rp1.available",
    "rp1.warehouse",
    "rp1.buildQueue",
    "rp1.buildable",
    "rp1.complexes",
    "rp1.pads",
    "rp1.operations",
    // The two editor channels, both read by contributed sections rather than by
    // the host: what the vehicle on the table costs to fly, and what tooling it
    // owes. Declared here because a widget's requirements are what the debug
    // surfaces enumerate, and a section's reads are the widget's reads.
    "rp1.buildCost",
    "rp1.tooling",
    // The spend rule: a rollout is billed as the vehicle moves, a scrap refunds
    // it, and starting a build buys the vehicle outright, so the balance those
    // are judged against has to be in here.
    "career.status",
  ],
  defaultConfig: {},
  actions: [],
  augmentSlots: [VEHICLE_ASSEMBLY_SECTIONS],
  pushable: true,
  owner: RP1,
});
