import {
  registerAugment,
  useCommand,
  useTelemetry,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Cluster,
  CommandButton,
  NULL_DISPLAY,
  Section,
  SectionTitle,
  Stack,
  Text,
  Unit,
  usePanelDelay,
} from "@ksp-gonogo/ui-kit";
import type {
  Rp1BuildableComplex,
  Rp1BuildableCraftEntry,
} from "../__generated__/contract";
import { current } from "../shared/current";
import { ProjectCard, ProjectCardList } from "../shared/ProjectCard";
import { RP1 } from "../uplink";
// Side-effect import: hydrates these Topics' units at decode time. Here rather
// than left to the entry point's import order, because this file is the
// consumer that would silently receive bare numbers without it.
import "../topics";
import { VEHICLE_ASSEMBLY_SECTIONS } from "./slot";

/**
 * Start integrating a design the space centre has never held. Must match
 * `Rp1BuildStartCommands.StartCommand`.
 */
export const RP1_BUILD_START_COMMAND = "rp1.build.start";

/**
 * The save's saved craft, and the complexes that would integrate each one.
 *
 * <para><b>What was missing.</b> The only build command RP-1 exposed COPIED a
 * vehicle the centre already held, so this widget could offer to order a second
 * Atlas and could never order a first one. Every career starts with nothing
 * built, which made that a dead end rather than a gap, and the surface answered
 * it by offering no build control at all. This is the general case.</para>
 *
 * <para><b>One button per complex that would take the craft, and a reason for
 * every one that would not.</b> A complex decides the mass and size a vehicle
 * may be, whether it may carry crew, and how fast it is built, so choosing one
 * is the whole of the decision an operator is making here. It is never chosen
 * for them, for the same reason a rollout never picks the pad: a mod that
 * silently picks when the choice looks obvious has taken the decision
 * anyway.</para>
 *
 * <para><b>The eligible verdicts are a preview, not a promise.</b> They are
 * measured from the craft file without loading it, so two of RP-1's own
 * conditions cannot be applied and are not: whether the craft is human-rated,
 * which RP-1 derives from part tags, and whether the complex stocks the
 * resources it needs. An unanswerable condition therefore leaves the button
 * PRESSABLE and lets the command refuse in RP-1's own words, which is strictly
 * better than a control drawn dark for a reason nobody could establish.</para>
 *
 * <para><b>Contributed rather than drawn by the host</b>, through the same slot
 * and the same `registerAugment` call an outside Uplink adding a section would
 * use.</para>
 */
export function BuildableSection() {
  const available = current(useTelemetry("rp1.available"));
  const buildable = current(useTelemetry("rp1.buildable"));

  // Unconditional and above the early returns on purpose: a hook after one
  // would change count on the first frame RP-1 answers.
  const start = useCommand(RP1_BUILD_START_COMMAND);
  usePanelDelay(start);

  // Invisible on every install without RP-1, which is most of them.
  if (available !== true) {
    return null;
  }

  return (
    <Section gap="sm">
      <SectionTitle>START A BUILD</SectionTitle>
      {buildable === undefined ? (
        // RP-1 has answered and this channel has not. Said rather than left
        // blank: an operator who sees nothing here has no way to tell a career
        // with no craft saved from an Uplink that is still connecting.
        <Text size="sm" tone="muted">
          Waiting for the craft listing
        </Text>
      ) : buildable.length === 0 ? (
        <Text size="sm" tone="muted">
          No craft saved. Design one in the VAB or SPH and it appears here.
        </Text>
      ) : (
        <ProjectCardList>
          {buildable.map((craft) => (
            <CraftCard craft={craft} handle={start} key={cardKey(craft)} />
          ))}
        </ProjectCardList>
      )}
    </Section>
  );
}

/**
 * One saved craft: what it is, what stock says it costs, and where it could be
 * built.
 *
 * <para>The card is toned by whether ANY complex would take it, because that is
 * the question it exists to answer. A craft nothing can build is still drawn,
 * with the reason: an operator who saved a craft and cannot find it here would
 * go looking for a fault in the Uplink.</para>
 */
function CraftCard({
  craft,
  handle,
}: Readonly<{
  craft: Rp1BuildableCraftEntry;
  handle: Parameters<typeof CommandButton>[0]["handle"];
}>) {
  const name = craft.shipName ?? craft.craftFile ?? NULL_DISPLAY;
  const file = craft.craftFile ?? null;
  const complexes = craft.complexes ?? [];
  const eligible = complexes.filter((complex) => complex.eligible === true);
  const partBlock = partRefusal(craft);

  return (
    <ProjectCard
      detail={
        <>
          {editorOf(craft)} ·
          {/* `~` rather than "costs about": the tilde is the conventional mark
              for an approximation and costs three characters where the phrase
              cost fourteen, on a card that is read at a glance. It is stock's
              price, which is what the wire can state before the press; RP-1
              settles the charge when the operator commits. */}{" "}
          ~<Unit value={craft.cost} />
        </>
      }
      name={name}
      tone={eligible.length > 0 && partBlock === null ? "go" : "warning"}
    >
      <Text size="xs" tone="muted">
        <Unit value={craft.mass} /> ·{" "}
        {craft.partCount === undefined ? (
          NULL_DISPLAY
        ) : (
          <Unit value={craft.partCount} />
        )}{" "}
        parts
      </Text>

      {partBlock !== null ? (
        <Text size="xs" tone="muted">
          Cannot be built: {partBlock}
        </Text>
      ) : file === null ? (
        // Readable and not commandable, and it says which. A craft with no
        // file name has no address, and guessing one from the ship name would
        // build whichever file the folder listed first.
        <Text size="xs" tone="muted">
          No craft file name for this design
        </Text>
      ) : (
        <Stack gap="sm">
          <Cluster gap="sm" justify="start" wrap>
            {eligible.map((complex) => (
              <CommandButton
                args={{
                  craftFile: file,
                  facility: craft.facility,
                  lcId: complex.lcId,
                }}
                aria-label={`Start building ${name} at ${complexLabel(complex)}`}
                commandLabel={`Start building ${name} at ${complexLabel(complex)}`}
                confirmAriaLabel={`Confirm starting ${name} at ${complexLabel(complex)}`}
                confirmLabel={<SpendWording cost={craft.cost} />}
                handle={handle}
                key={complex.lcId ?? complexLabel(complex)}
                label={
                  eligible.length === 1
                    ? "Start build"
                    : `Build at ${complex.name ?? complexLabel(complex)}`
                }
                size="sm"
              />
            ))}
          </Cluster>
          <Refusals complexes={complexes} />
        </Stack>
      )}
    </ProjectCard>
  );
}

/**
 * Why each complex that refused this craft refused it.
 *
 * <para>Drawn even when another complex WOULD take it, because "LC-1 is too
 * small for this" is what tells an operator which complex to modify, and a list
 * that only showed the complexes that said yes would leave them pressing the
 * one button they have and never learning why there is only one.</para>
 *
 * <para>A complex with no reasons at all is skipped rather than drawn as a
 * blank line: it is one that said yes, and it has a button above.</para>
 */
function Refusals({
  complexes,
}: Readonly<{ complexes: readonly Rp1BuildableComplex[] }>) {
  const refused = complexes.filter(
    (complex) => (complex.refusals ?? []).length > 0,
  );
  if (refused.length === 0) {
    return null;
  }

  return (
    <Stack gap="xs">
      {refused.map((complex) => (
        <Text
          key={complex.lcId ?? complexLabel(complex)}
          size="xs"
          tone="muted"
        >
          {complexLabel(complex)}: {(complex.refusals ?? []).join("; ")}
        </Text>
      ))}
    </Stack>
  );
}

/**
 * Why the craft's PARTS stop it being built anywhere, or null when they do not.
 *
 * <para>Three separate causes with three different remedies, and each is named
 * rather than collapsed into "cannot be built": a part this install does not
 * have needs the mod installing, a part whose tech is not researched needs the
 * research queue, and a part researched but not bought needs money spent at
 * R&amp;D. The last is the one that would otherwise surprise: RP-1's own window
 * offers to spend it for you through a popup, and a command dispatched from
 * another machine has nobody to answer that.</para>
 */
function partRefusal(craft: Rp1BuildableCraftEntry): string | null {
  const missing = craft.missingParts ?? [];
  if (missing.length > 0) {
    return `this install does not have ${missing.join(", ")}`;
  }
  const locked = craft.lockedParts ?? [];
  if (locked.length > 0) {
    return `not researched yet: ${locked.join(", ")}`;
  }
  const unpurchased = craft.unpurchasedParts ?? [];
  if (unpurchased.length > 0) {
    return `researched but not bought, unlock at R&D first: ${unpurchased.join(", ")}`;
  }
  return null;
}

/**
 * What a build will cost, on the confirm wording rather than the resting one.
 * An operator scanning a list wants the names; an operator about to spend wants
 * the number.
 *
 * <para>"about", because the wire carries stock's price and RP-1 settles the
 * charge at the press: leaders and strategies move what a vessel purchase
 * costs, and quoting the unmodified figure as final would send an operator
 * looking for funds they already have.</para>
 */
function SpendWording({
  cost,
}: Readonly<{ cost: Rp1BuildableCraftEntry["cost"] }>) {
  return (
    <>
      Spend ~<Unit value={cost} />
    </>
  );
}

/**
 * The complex, named the way the key line at the top of the widget names it, so
 * a refusal can be matched to a card without joining another channel. Two space
 * centres may each have an LC-1, which is why the centre is here at all.
 */
function complexLabel(complex: Rp1BuildableComplex): string {
  const name = complex.name ?? complex.lcId ?? "an unnamed complex";
  const centre = complex.kscDisplayName ?? complex.kscName;
  return centre === undefined ? name : `${name} at ${centre}`;
}

/**
 * Which editor drew the craft, from KSP's own ordinal. Named rather than
 * numbered, and a dash for an ordinal nobody sent: the facility is what decides
 * whether the craft belongs at a launch complex or the hangar, so a substituted
 * default would be a claim about where it can be built.
 */
function editorOf(craft: Rp1BuildableCraftEntry): string {
  if (craft.facility === 1) {
    return "VAB";
  }
  if (craft.facility === 2) {
    return "SPH";
  }
  return NULL_DISPLAY;
}

/**
 * A stable row key. The file name addresses a craft within one editor's folder
 * and the VAB and SPH may each hold one of the same name, so the editor is part
 * of the key for the same reason it is part of the command's arguments.
 */
function cardKey(craft: Rp1BuildableCraftEntry): string {
  return `${craft.facility ?? "?"}:${craft.craftFile ?? craft.shipName ?? "?"}`;
}

registerAugment({
  id: "rp1-vehicle-assembly-buildable",
  augments: VEHICLE_ASSEMBLY_SECTIONS,
  component: BuildableSection,
  // LAST, after what is built and what is being built. An operator opens this
  // widget to see the work in flight; starting new work is the thing they do
  // once they have, and a list of every saved craft above the queue would bury
  // it.
  priority: 20,
  owner: RP1,
});
