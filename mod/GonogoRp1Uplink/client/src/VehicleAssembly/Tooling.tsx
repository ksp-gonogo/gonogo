import {
  magnitudeOf,
  registerAugment,
  useCommand,
  useTelemetry,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Cluster,
  CommandButton,
  Disclosure,
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
  Rp1ToolingEntry,
  Rp1ToolingRefitTarget,
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
 * Buy every tooling the vehicle on the editor's table is missing, in one
 * purchase. Must match `Rp1ToolingCommands.ToolAllCommand`.
 */
export const RP1_TOOL_ALL_COMMAND = "rp1.tooling.toolAll";

/**
 * Reshape one part to a size the career already owns, instead of buying its
 * tooling. Must match `Rp1ToolingCommands.RefitCommand`.
 */
export const RP1_TOOLING_REFIT_COMMAND = "rp1.tooling.refit";

/**
 * What tooling the vehicle being designed needs, what finishing it costs, and
 * what it costs not to.
 *
 * <para><b>Tooling is career-global and keyed on a SIZE, not on a part.</b> RP-1
 * holds a database of toolings, each one a type and an ordered tuple of
 * parameters, and a part is tooled when the career owns a tooling of its type
 * whose parameters match within four per cent. Two parts of one size are
 * therefore one purchase between them, and the second is free. That is the fact
 * this section is shaped around: the rows are PURCHASES, gathered from the parts
 * that need them, rather than one row per part.</para>
 *
 * <para><b>Two money figures, asking different questions.</b> A purchase's price
 * is paid ONCE. Its parts' surcharges are paid on EVERY copy of the vehicle ever
 * built, for ever, because an untooled part carries a penalty through the game's
 * own part-cost modifier. The decision an operator is making here is never "what
 * does tooling cost", it is "tool once, or pay that again on every build", so
 * both figures are on screen without either being derived from the other.</para>
 *
 * <para><b>The whole-ship price is not the sum of the rows and is not drawn like
 * one.</b> RP-1's own Tool All figure is deduplicated across the fuzzy match, so
 * paying for one size can leave a neighbouring size free and the column adds up
 * to more than the vehicle costs. It sits with the control it is the price of,
 * away from the foot of the column where a total would go.</para>
 *
 * <para><b>No affordability verdict is drawn here.</b> RP-1 charges a tooling
 * purchase through its unlock-credit pool before it reaches funds, so the funds
 * balance alone does not decide whether a price can be met, and the split is the
 * producer's to make. The command asks RP-1 and refuses in RP-1's own words. The
 * host draws both balances for the same reason.</para>
 *
 * <para><b>Two ways to close the gap, and the second one is free.</b> A part can
 * have its tooling bought, or it can be RESHAPED to a size the career already
 * owns. The second spends nothing at all and is the one an early career reaches
 * for, so it is offered on the part rather than left to the game's own window:
 * `rp1.tooling[].refitTargets` carries the owned sizes this part could move to,
 * already filtered by RP-1's own material picker to ones it can actually use.
 * A refit is per PART where a purchase is per SIZE, which is why the presses
 * live on the part rows and the price lives on the card.</para>
 */
export function ToolingSection() {
  const available = current(useTelemetry("rp1.available"));
  const tooling = current(useTelemetry("rp1.tooling"));

  // Unconditional and above the early returns on purpose: a hook after one
  // would change count on the first frame RP-1 answers.
  const toolAll = useCommand(RP1_TOOL_ALL_COMMAND);
  const refit = useCommand(RP1_TOOLING_REFIT_COMMAND);
  usePanelDelay(toolAll);
  usePanelDelay(refit);

  // Invisible on every install without RP-1, which is most of them.
  if (available !== true) {
    return null;
  }

  /* No sample is NOT "everything is tooled", and rendering it as one would
     state the single thing this channel refuses to say. RP-1 keeps these
     figures only while a ship is on the editor's table, and its own level
     lookup short-circuits every part to tooled when tooling is switched off, so
     a reading taken then would report a finished vehicle. Silence, as the
     costs section beside this does for the same reason. */
  if (tooling === undefined) {
    return null;
  }

  const purchases = groupIntoPurchases(tooling.parts ?? []);
  if (purchases.length === 0) {
    return null;
  }

  const outstanding = magnitudeOf(tooling.untooledCount) ?? 0;

  return (
    <Section gap="sm" data-tooling-section="">
      <SectionTitle>TOOLING</SectionTitle>

      {/* The whole-ship price and the control that spends it, together and
          above the rows. Below them it would be read as their total, which it
          is not: the fuzzy match makes RP-1's figure the smaller number by
          however much one size covers another. */}
      {outstanding > 0 && (
        <Cluster gap="sm" justify="start" wrap data-tooling-header="">
          <Text size="sm" tone="muted">
            Tool all{" "}
            {tooling.toolAllCost == null ? (
              NULL_DISPLAY
            ) : (
              <Unit value={tooling.toolAllCost} decimals={0} />
            )}
          </Text>
          <CommandButton
            args={{}}
            aria-label="Tool this vehicle"
            commandLabel="Tool this vehicle"
            confirmAriaLabel="Confirm tooling this vehicle"
            confirmLabel={<SpendWording cost={tooling.toolAllCost} />}
            handle={toolAll}
            label="Tool all"
            size="sm"
          />
        </Cluster>
      )}

      <ProjectCardList>
        {purchases.map((purchase) => (
          <PurchaseCard key={purchase.key} purchase={purchase} refit={refit} />
        ))}
      </ProjectCardList>
    </Section>
  );
}

/**
 * One tooling the vehicle needs, and every part on the vehicle that needs it.
 *
 * <para>The parts are held rather than counted, because a purchase covering
 * three parts and a purchase covering one are the same price and a bare count
 * would not say WHICH parts stop being penalised.</para>
 */
interface Purchase {
  key: string;
  /** The type as RP-1 titles it. */
  heading: string;
  size: string | undefined;
  /** Whether the career already owns this one. */
  tooled: boolean;
  /** What finishing it costs now, once, for every part below. */
  cost: Rp1ToolingEntry["toolingCost"];
  parts: readonly Rp1ToolingEntry[];
}

/**
 * The parts gathered into the purchases that would cover them.
 *
 * <para>The key is the tooling type and the parameter summary together, which is
 * the contract's own statement of when two rows are one purchase. It is the
 * EXACT match only: RP-1 also covers anything within four per cent, so two
 * different sizes can share a tooling in a way nothing on this wire can see.
 * That residue is precisely why the whole-ship price is RP-1's own figure and is
 * never added up from here.</para>
 *
 * <para>Order is the order RP-1 listed the parts in, taken from where each
 * purchase is first needed. A purchase drawn where its first part appears keeps
 * the list in the order an operator reads the vehicle.</para>
 */
function groupIntoPurchases(parts: readonly Rp1ToolingEntry[]): Purchase[] {
  const byKey = new Map<string, Purchase>();
  for (const part of parts) {
    /* A unit separator rather than a visible one: a tooling type is an
       identifier and a summary is free text, and any character that could
       appear in either would join two purchases that are not one. */
    const key = `${part.toolingType ?? ""}${part.parameterSummary ?? ""}`;
    const held = byKey.get(key);
    if (held === undefined) {
      byKey.set(key, {
        key,
        heading:
          part.toolingTypeTitle ?? part.toolingType ?? "an unnamed tooling",
        size: part.parameterSummary ?? undefined,
        tooled: part.tooled === true,
        cost: part.toolingCost,
        parts: [part],
      });
      continue;
    }
    byKey.set(key, { ...held, parts: [...held.parts, part] });
  }
  return [...byKey.values()];
}

/**
 * One purchase: what it buys, what it costs once, and what each part it covers
 * is being charged in the meantime.
 *
 * <para>Toned by whether it is outstanding, because that is the question the
 * card exists to answer, and an owned tooling is drawn at all so the section can
 * say the money has already been spent rather than leaving an operator to infer
 * it from a part's absence.</para>
 */
function PurchaseCard({
  purchase,
  refit,
}: Readonly<{
  purchase: Purchase;
  refit: Parameters<typeof CommandButton>[0]["handle"];
}>) {
  return (
    <ProjectCard
      badge={
        purchase.tooled ? <Badge severity="nominal">Tooled</Badge> : undefined
      }
      detail={purchase.size}
      name={purchase.heading}
      tone={purchase.tooled ? "go" : "warning"}
    >
      {/* The once-off price, and only where there is one to pay. An owned
          tooling priced at zero would read as a purchase that happens to be
          free rather than as one already made. */}
      {!purchase.tooled && (
        <Row as="div" data-tooling-once="">
          <RowName>Once</RowName>
          {purchase.cost == null ? (
            <Text>{NULL_DISPLAY}</Text>
          ) : (
            <Unit value={purchase.cost} decimals={0} />
          )}
        </Row>
      )}

      {purchase.parts.map((part) => (
        <PartCharge
          key={part.partId ?? part.partTitle}
          owned={purchase.tooled}
          part={part}
          refit={refit}
        />
      ))}
    </ProjectCard>
  );
}

/**
 * One part this purchase covers, and what flying it untooled costs per build.
 *
 * <para>Drawn NESTED under the once-off price, and the indent is the statement:
 * the surcharge belongs to the part, the price belongs to the purchase, and a
 * card with two parts has one price and two surcharges. Level with each other
 * they read as two entries in one column, which is the reading that makes an
 * operator add a price they only pay once to a penalty they pay for ever.</para>
 *
 * <para>A part whose surcharge RP-1 did not report is still named: it is covered
 * by the purchase either way, and dropping it would understate what the money
 * buys.</para>
 *
 * <para><b>A part under an OWNED tooling is named and carries no charge.</b> RP-1
 * reports its surcharge as a zero rather than as absent, because its part-cost
 * modifier genuinely adds nothing to a tooled part, and a zero drawn beside the
 * word "per build" is a bill for nothing. Nothing is what a tooled part owes, and
 * the honest rendering of that is no figure at all.</para>
 *
 * <para><b>One flowing line rather than a name-and-value row, and a render is
 * what settled it.</b> As a row this was a `RowName` beside the figure, and
 * `RowName` yields all of its width before the figure gives up any: at this
 * card's width two different tanks both rendered as "Procedural ...", so the card
 * showed two identical rows naming two different parts. `Row`'s own `wrap` did
 * not buy back enough, because the minimum width it guarantees is still shorter
 * than a part title. A part title is the only thing here that says WHICH part
 * stops being penalised, so it is the last thing that may go, and text that
 * wraps cannot truncate. The right-aligned money column is given up for it; the
 * figure the card is read for is the once-off price above, and that one keeps
 * its column.</para>
 */
function PartCharge({
  owned,
  part,
  refit,
}: Readonly<{
  owned: boolean;
  part: Rp1ToolingEntry;
  refit: Parameters<typeof CommandButton>[0]["handle"];
}>) {
  const name = part.partTitle ?? part.partId ?? NULL_DISPLAY;
  if (owned || part.untooledSurcharge == null) {
    return (
      <Row as="div" nested wrap>
        <Text size="xs" tone="muted">
          {name}
        </Text>
      </Row>
    );
  }
  return (
    <Stack gap="xs">
      <Row as="div" nested wrap data-tooling-per-build="">
        <Text size="xs" tone="muted">
          {name} · <Unit value={part.untooledSurcharge} decimals={0} /> per
          build
        </Text>
      </Row>
      <RefitControl handle={refit} name={name} part={part} />
    </Stack>
  );
}

/**
 * The other way to close this part's gap: move it to a size the career has
 * already paid for.
 *
 * <para><b>It spends nothing, and that is the whole of its money statement.</b>
 * `ToolingPartResizer.Resize` changes the part's geometry and its tank material
 * and touches no currency anywhere, read on the shipped RP-1 v4.6.0.0 RP0.dll.
 * So the line beside the presses names what the refit STOPS costing rather than
 * what it costs: the untooled surcharge is charged on every copy of the vehicle
 * ever built, and a part refitted onto an owned tooling stops paying it.</para>
 *
 * <para><b>It reaches further than the part named, and says so first.</b> Every
 * symmetry counterpart is resized too and the material is applied across the
 * part's group. RP-1 discloses both AFTERWARDS in a screen message; the count is
 * on the wire so it can be said while it can still change the answer.</para>
 *
 * <para><b>Each row is a size, and the material is the producer's.</b> The rows
 * are owned toolings RP-1's own picker has already matched to something this
 * part can use, tech locks included, so the press sends back the material it was
 * given rather than choosing one. A part with no rows gets no control: EMPTY
 * means the career owns nowhere to move, and buying the tooling is then the only
 * way.</para>
 */
function RefitControl({
  handle,
  name,
  part,
}: Readonly<{
  handle: Parameters<typeof CommandButton>[0]["handle"];
  name: string;
  part: Rp1ToolingEntry;
}>) {
  const partId = part.partId;
  const targets = part.refitTargets ?? [];
  if (partId == null || targets.length === 0) {
    return null;
  }

  const others = magnitudeOf(part.symmetryCounterparts) ?? 0;

  return (
    <Disclosure
      ariaLabel={`Refit ${name} to a size the career already owns`}
      asButton
      buttonSize="sm"
      chevron={false}
      label={(open: boolean) => (open ? "Hide refit" : "Refit instead")}
      panelHeight="auto"
      variant="inline"
    >
      <Stack gap="xs">
        {/*
          One line rather than a paragraph and a warning band, on the repo's own
          compress-the-rows rule and on a render: three lines of warn tone above
          two presses read as a hazard, and a refit is a free reversible edit.
          The reach is a FACT about what the press does, so it is stated in the
          same muted line as the money.
        */}
        <Text size="xs" tone="muted">
          costs nothing, and drops the{" "}
          <Unit value={part.untooledSurcharge} decimals={0} /> per build
          {others > 0 && (
            <>
              {" · takes "}
              {others} other part{others === 1 ? "" : "s"} in symmetry, and the
              material goes on the group
            </>
          )}
        </Text>
        {targets.map((target) => (
          <RefitRow
            handle={handle}
            key={`${magnitudeOf(target.diameter)}x${magnitudeOf(target.length)}`}
            name={name}
            partId={partId}
            target={target}
          />
        ))}
      </Stack>
    </Disclosure>
  );
}

/**
 * One owned size, and the press that moves the part onto it.
 *
 * <para>The accessible name follows RP-1's own sentence for the act and its
 * three-decimal rendering, because that is the wording an operator who has used
 * the game's window already reads. It spells METRES rather than carrying RP-1's
 * `d=3.000m, L=5.000m`: a symbol beside a number in a string is announced as a
 * letter, and the visible figures beside the press are `Unit`s, which is where
 * the symbol belongs. A row missing either figure is dropped rather than pressed
 * at a size nobody named.</para>
 */
function RefitRow({
  handle,
  name,
  partId,
  target,
}: Readonly<{
  handle: Parameters<typeof CommandButton>[0]["handle"];
  name: string;
  partId: string;
  target: Rp1ToolingRefitTarget;
}>) {
  const diameter = magnitudeOf(target.diameter);
  const length = magnitudeOf(target.length);
  if (diameter === null || length === null || target.rfType == null) {
    return null;
  }
  const press = `Refit ${name} to ${diameter.toFixed(3)} metres across by ${length.toFixed(3)} metres long, in ${target.rfType}`;

  return (
    <Row as="div" nested>
      <Text size="xs">
        <Unit value={target.diameter} /> × <Unit value={target.length} />
      </Text>
      <CommandButton
        args={{ diameter, length, partId, rfType: target.rfType }}
        aria-label={press}
        commandLabel={press}
        handle={handle}
        label="Refit"
        size="sm"
      />
    </Row>
  );
}

/**
 * What the confirm press spends.
 *
 * <para>A price RP-1 could not read is the null dash rather than a zero, and the
 * press is still offered: the command reads the same field itself and refuses in
 * RP-1's own words if it really is unreadable, which is a better answer than a
 * control drawn dark for a reason nobody could establish.</para>
 */
function SpendWording({
  cost,
}: Readonly<{ cost: Rp1ToolingEntry["toolingCost"] }>) {
  if (cost == null) {
    return <>Spend {NULL_DISPLAY}</>;
  }
  return (
    <>
      Spend <Unit value={cost} decimals={0} />
    </>
  );
}

registerAugment({
  id: "rp1-vehicle-assembly-tooling",
  augments: VEHICLE_ASSEMBLY_SECTIONS,
  component: ToolingSection,
  /** Immediately under the launch cost, whose untooled line is the figure this
   *  section breaks down, and above both vehicle lists for the same reason that
   *  one is: it is about the craft being designed now. */
  priority: -0.5,
  owner: RP1,
});
