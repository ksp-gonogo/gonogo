import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Card,
  Cluster,
  CommandButton,
  Disclosure,
  Inline,
  magnitudeOf,
  NULL_DISPLAY,
  ProgressBar,
  Row,
  RowName,
  Stack,
  Stepper,
  Text,
  Unit,
} from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import type {
  Rp1ComplexEntry,
  Rp1LcPricing,
  Rp1PadEntry,
  Rp1RushTerms,
} from "../__generated__/contract";
import { DismantleControl, PadRows, RenameControl } from "./Lifecycle";
import { ModifyControl } from "./Modify";

/**
 * ONE launch complex, drawn as the thing an operator administers.
 *
 * <para><b>The card says whose it is.</b> A complex belongs to a space centre,
 * and RP-1's hierarchy is the fact this widget exists to make legible: the
 * facilities above it are one set for the whole career, a centre is a place, and
 * a complex is one of several at that place. The centre's name is on every card
 * even when the career has only one, because the confusion this repeats to
 * prevent is not "which centre" but "what kind of thing am I looking at".</para>
 *
 * <para><b>Staffing and eligibility are different questions and are drawn
 * apart.</b> The crew decides how FAST this complex works, and nobody staffs
 * their way past the envelope: a vehicle over the mass limit, over the size
 * limit, or needing a resource the complex does not handle cannot be built here
 * at any headcount. Reading the two as one is how an operator ends up assigning
 * engineers to a complex that was never going to take their rocket.</para>
 */
export function ComplexCard({
  complex,
  centreName,
  complexNames,
  unassigned,
  pads,
  terms,
  assign,
  rush,
  dismantle,
  dismantlePad,
  funds,
  modify,
  newPad,
  pricing,
  renameComplex,
  renamePad,
}: Readonly<{
  complex: Rp1ComplexEntry;
  centreName: string;
  /** Every complex in the career by id, so the shared-crew line can name its peers. */
  complexNames: ReadonlyMap<string, string>;
  /** The centre's free pool, which is the ceiling on what this crew can grow by. */
  unassigned: number | null;
  pads: readonly Rp1PadEntry[];
  terms: Rp1RushTerms | undefined;
  assign: Parameters<typeof CommandButton>[0]["handle"];
  rush: Parameters<typeof CommandButton>[0]["handle"];
  dismantle: Parameters<typeof CommandButton>[0]["handle"];
  dismantlePad: Parameters<typeof CommandButton>[0]["handle"];
  /** The career balance, so a pad quote can say whether it is covered. */
  funds: number | null;
  modify: Parameters<typeof CommandButton>[0]["handle"];
  newPad: Parameters<typeof CommandButton>[0]["handle"];
  /** RP-1's pricing settings, for the renovation quote. */
  pricing: Rp1LcPricing | undefined;
  renameComplex: Parameters<typeof CommandButton>[0]["handle"];
  renamePad: Parameters<typeof CommandButton>[0]["handle"];
}>) {
  const name = complex.name ?? NULL_DISPLAY;
  const engineers = magnitudeOf(complex.engineers);
  const maxEngineers = magnitudeOf(complex.maxEngineers);
  const operational = complex.isOperational === true;
  const rushing = complex.isRushing === true;
  const unstaffed = operational && engineers === 0;

  return (
    <Card tone={unstaffed ? "warning" : operational ? "go" : "default"}>
      <Stack gap="lg">
        <Cluster gap="xs" wrap>
          <Text weight="semibold">{name}</Text>
          <Inline gap="xs">
            {complex.humanRated === true && (
              <Badge severity="info">HUMAN-RATED</Badge>
            )}
            {rushing && <Badge severity="caution">RUSHING</Badge>}
            {/* Beside the card's other states rather than under the crew bar,
                where it was a badge and a sentence about what the badge means.
                Read off `unstaffed`, so a complex still being built does not
                report a crew shortage on top of NOT YET BUILT. */}
            {unstaffed && <Badge severity="caution">NOBODY ASSIGNED</Badge>}
            {operational ? null : (
              <Badge severity="offline">NOT YET BUILT</Badge>
            )}
          </Inline>
        </Cluster>

        <Crew
          complex={complex}
          complexNames={complexNames}
          engineers={engineers}
          maxEngineers={maxEngineers}
          name={name}
        />

        {operational && (
          <AssignControl
            centreName={centreName}
            complex={complex}
            engineers={engineers}
            handle={assign}
            maxEngineers={maxEngineers}
            name={name}
            unassigned={unassigned}
          />
        )}

        {/*
          Everything below the crew is behind one expander, on the operator's
          ruling that a complex was "using a lot of space for quite boilerplate
          information". What stays above it is what changes and what is acted on:
          the crew, because RP-1 advances work at Engineers/MaxEngineers so a
          complex with nobody assigned builds nothing, and the badges, because a
          rushing complex is paying double salary and an unstaffed one is idle.
          The envelope, the costs and the pads are reference: true for months at a
          time and read when a decision needs them.

          A small trailing button rather than the full-width chevron band the
          inline default draws, which the operator called "not great": a clickable
          strip the width of the card reads as the card's own header, not as a
          control on it. `asButton` + `chevron={false}` is the kit's own pairing
          for a worded trigger, and it sizes to its label at the row's end.
        */}
        <Disclosure
          ariaLabel={`Detail for ${name}`}
          asButton
          buttonSize="sm"
          chevron={false}
          label={(open: boolean) => (open ? "Hide detail" : "Show detail")}
          panelHeight="auto"
          variant="inline"
        >
          <Stack gap="sm">
            {rushing && <RushStatus terms={terms} />}
            <Envelope complex={complex} />
            <Costs complex={complex} />
            {complex.lcId != null && (
              <Inline gap="xs">
                <RenameControl
                  args={{ lcId: complex.lcId }}
                  currentName={name}
                  handle={renameComplex}
                  label={name}
                  taken={[...complexNames.values()]}
                />
              </Inline>
            )}
            <PadRows
              complex={complex}
              dismantlePad={dismantlePad}
              funds={funds}
              newPad={newPad}
              pads={pads}
              renamePad={renamePad}
            />
            {operational && (
              <RushControl complex={complex} handle={rush} name={name} />
            )}
            {/* Immediately under the envelope and the costs, which are what a
                renovation changes and what it is priced against. Above the
                dismantle, because it is the reversible one of the two. */}
            <ModifyControl
              complex={complex}
              funds={funds}
              handle={modify}
              pricing={pricing}
            />

            <DismantleControl
              complex={complex}
              handle={dismantle}
              name={name}
            />
          </Stack>
        </Disclosure>
      </Stack>
    </Card>
  );
}

/**
 * The crew, and the share of the complex's full rate it buys.
 *
 * <para>RP-1 advances work at <c>Engineers / MaxEngineers</c>, so the fraction
 * is not a decoration: it IS the rate. Drawn as a bar because that is the one
 * number on the card an operator changes to make something happen sooner.</para>
 *
 * <para>A complex with nobody assigned is called out rather than left to be
 * inferred from "0 / 60". It builds NOTHING, whatever the career has hired and
 * whatever is queued on it, and that is the single most consequential state this
 * widget can show.</para>
 */
function Crew({
  complex,
  complexNames,
  engineers,
  maxEngineers,
  name,
}: Readonly<{
  complex: Rp1ComplexEntry;
  complexNames: ReadonlyMap<string, string>;
  engineers: number | null;
  maxEngineers: number | null;
  name: string;
}>) {
  const share =
    engineers !== null && maxEngineers !== null && maxEngineers > 0
      ? engineers / maxEngineers
      : null;

  return (
    <Stack gap="xs">
      <Cluster gap="xs" wrap>
        <Text size="xs" tone="muted">
          crew
        </Text>
        <Text size="xs">
          <Unit value={complex.engineers} /> /{" "}
          <Unit value={complex.maxEngineers} />
          {complex.efficiency !== undefined && complex.efficiency !== null && (
            <>
              {" · "}
              <Unit value={complex.efficiency} /> efficiency
            </>
          )}
        </Text>
      </Cluster>
      <SharedRating complex={complex} complexNames={complexNames} />
      {share === null ? null : (
        <ProgressBar
          ariaLabel={`Crew assigned to ${name}, as a share of what it can hold`}
          value={share * 100}
        />
      )}
    </Stack>
  );
}

/**
 * How many engineers one press moves. RP-1's own four, and the fourth is its
 * <c>int.MaxValue</c> drawn as the word it means.
 */
const STEPS = [1, 10, 100, "all"] as const;
type Step = (typeof STEPS)[number];

/**
 * The control that changes who works here: RP-1's own shape, stepped.
 *
 * <para><b>Two ceilings, drawn as two figures.</b> A press is refused for one of
 * two unrelated reasons, and RP-1 clamps against both: the centre may have
 * nobody free to move (<c>KSC.UnassignedEngineers</c>) and this complex may
 * already be full (<c>MaxEngineers - Engineers</c>). A single range would render
 * them as the same end of the same track, so an operator who cannot press could
 * not tell which of the two to go and fix. They are separate readouts, each
 * turning to warning tone at zero, and the press itself carries the number it
 * would actually move rather than the step that was picked.</para>
 *
 * <para><b>A step in the hand, a TARGET on the wire.</b> The command carries the
 * absolute headcount the press works out to, not a delta: an operator commanding
 * from a remote vantage is reading a crew count as it was, and "+10" applied to
 * a count that has since moved lands somewhere nobody chose.</para>
 *
 * <para>No arm-then-confirm, because this spends nothing at the moment it lands:
 * the engineers are already hired and already drawing salary. What it changes is
 * the RATE they draw it at, which the card's own cost line carries.</para>
 */
function AssignControl({
  complex,
  engineers,
  maxEngineers,
  unassigned,
  centreName,
  name,
  handle,
}: Readonly<{
  complex: Rp1ComplexEntry;
  engineers: number | null;
  maxEngineers: number | null;
  unassigned: number | null;
  centreName: string;
  name: string;
  handle: Parameters<typeof CommandButton>[0]["handle"];
}>) {
  const [step, setStep] = useState<Step>(1);
  const lcId = complex.lcId;

  if (
    lcId === undefined ||
    lcId === null ||
    engineers === null ||
    maxEngineers === null
  ) {
    // Said rather than left blank: a control that is simply not drawn reads as a
    // widget that forgot to draw it.
    return (
      <Text size="xs" tone="muted">
        {NULL_DISPLAY} RP-1 has not said how many engineers this complex holds
      </Text>
    );
  }

  const room = Math.max(0, maxEngineers - engineers);
  // A centre that has not answered for its pool imposes no limit of its own, so
  // the complex's ceiling is the only one left standing.
  const free = unassigned === null ? room : Math.max(0, unassigned);
  const size = step === "all" ? Number.POSITIVE_INFINITY : step;
  const grow = Math.min(size, free, room);
  const shrink = Math.min(size, engineers);

  return (
    <Stack gap="xs">
      {/*
        RP-1's own layout, which the operator asked for by name. Its personnel
        window reads `Assigned: [-1] 44 [+1]  Max: 60`, with `Engineers: 50
        Unassigned: 6` above: the two buttons CARRY the number they will move, and
        the size comes from a held modifier key (none/shift/ctrl/alt for
        1/10/100/all) rather than from anything on screen.

        A dashboard cannot use modifier keys, so the size is a control here, drawn
        as a labelled SETTING rather than a row of actions: a selected step among
        buttons reads as a button already pressed, which is what the operator saw
        in "The 1 option is highlighted on every LC... it looks like 1 is already
        pressed". A Stepper has a value between two arrows and no pressed state.
      */}
      <Cluster align="center" gap="sm" wrap>
        <Inline gap="xs">
          {/* The quantity, named. It read "step", which the operator answered
              with "Step what?": a bare "step" says the control moves something
              by an amount and leaves the something out, and the amount here is
              engineers per press of the two buttons beside it. */}
          <Text size="xs" tone="muted">
            engineers per press
          </Text>
          <Stepper
            label={`Engineers moved per press at ${name}`}
            onChange={setStep}
            options={STEPS}
            value={step}
          />
        </Inline>

        {/*
          Always a symmetric pair, and each side always shows the number it would
          move. The operator saw "a '-1' and a '+' together" because the grow side
          fell back to a bare glyph when it could not move: a disabled button that
          drops its number stops being the other half of a pair.
        */}
        <Inline gap="xs">
          <CommandButton
            args={{ engineers: engineers - shrink, lcId }}
            aria-label={
              shrink === 0
                ? `Nobody is assigned to ${name}`
                : `Return ${shrink} engineers from ${name} to ${centreName}, leaving ${engineers - shrink}`
            }
            commandLabel={`Assign ${engineers - shrink} engineers to ${name}`}
            disabled={shrink === 0}
            handle={handle}
            label={`−${shrink === 0 ? (size === Number.POSITIVE_INFINITY ? 0 : size) : shrink}`}
            size="sm"
          />
          <CommandButton
            args={{ engineers: engineers + grow, lcId }}
            aria-label={
              grow === 0
                ? room === 0
                  ? `${name} is full`
                  : `No engineers free at ${centreName} to assign to ${name}`
                : `Assign ${grow} more engineers to ${name}, ${engineers + grow} in all`
            }
            commandLabel={`Assign ${engineers + grow} engineers to ${name}`}
            disabled={grow === 0}
            handle={handle}
            label={`+${grow === 0 ? (size === Number.POSITIVE_INFINITY ? 0 : size) : grow}`}
            size="sm"
          />
        </Inline>
      </Cluster>

      {/*
        RP-1's own two readings, as label and value. The sentences these replace
        ("free at Cape 0", "room here 16") were the operator's "too much flourish":
        a reading is a label and a number.
      */}
      <Stack as="ul" gap="xs" style={LIST_STYLE}>
        <Row>
          <RowName>Unassigned</RowName>
          <Text size="xs" tone={free === 0 ? "warn" : undefined}>
            <Unit
              value={
                unassigned === null ? undefined : value("count", unassigned)
              }
            />
          </Text>
        </Row>
        <Row>
          <RowName>Max</RowName>
          <Text size="xs" tone={room === 0 ? "warn" : undefined}>
            <Unit value={complex.maxEngineers} />
          </Text>
        </Row>
      </Stack>
    </Stack>
  );
}

/**
 * What rushing is doing to this complex, while it is doing it.
 *
 * <para>On the card rather than once for the section, and only on a complex that
 * is actually rushing: these are the terms in force here now, which is a reading
 * rather than a note about how RP-1 works. A quiet complex shows none of it, so
 * the figures never repeat across the career's complexes.</para>
 *
 * <para>The efficiency line is the term RP-1's own tooltip leaves out, and the
 * one that costs the most over a career: a rushing complex's crew gains no
 * efficiency for the whole time it runs.</para>
 */
function RushStatus({ terms }: Readonly<{ terms: Rp1RushTerms | undefined }>) {
  return (
    <Cluster gap="xs" wrap>
      <Text size="xs" tone="muted">
        rushing
      </Text>
      <Text size="xs">
        {terms === undefined ? (
          <>{NULL_DISPLAY} RP-1 has not said what rushing costs</>
        ) : (
          <>
            <Unit value={terms.rateMult} /> rate ·{" "}
            <Unit value={terms.salaryMult} /> salary · efficiency held
          </>
        )}
      </Text>
    </Cluster>
  );
}

/**
 * Who else this crew rating belongs to.
 *
 * <para>Kept, where the renovation and complex-kind lines were cut, because it is
 * a FACT that changes how the number above it is read rather than an explanation
 * of that number: RP-1 rates an efficiency RECORD rather than a complex, so work
 * done next door moves the figure here, and an operator watching it climb while
 * nobody is assigned has been told something untrue.</para>
 *
 * <para>A label and a value, not a sentence, which is the form the operator asked
 * for. Absent entirely when the rating is this complex's alone.</para>
 */
function SharedRating({
  complex,
  complexNames,
}: Readonly<{
  complex: Rp1ComplexEntry;
  complexNames: ReadonlyMap<string, string>;
}>) {
  const peers = complex.efficiencySharedWith ?? [];
  if (peers.length === 0) {
    return null;
  }
  return (
    <Stack as="ul" gap="xs" style={LIST_STYLE}>
      <Row>
        <RowName>Shared with</RowName>
        <Text size="xs">
          {peers.map((lcId) => complexNames.get(lcId) ?? lcId).join(", ")}
        </Text>
      </Row>
    </Stack>
  );
}

/**
 * What this complex will take at all, which no amount of staffing changes.
 *
 * <para>Every limit is absent rather than infinite when RP-1 has no limit: the
 * hangar's mass and size come through as the float sentinel, and a client that
 * printed the sentinel would show an operator a number where the answer is
 * "anything".</para>
 */
function Envelope({ complex }: Readonly<{ complex: Rp1ComplexEntry }>) {
  const height = complex.sizeMaxHeight;
  const width = complex.sizeMaxWidth;
  const depth = complex.sizeMaxDepth;
  const sized =
    height !== undefined &&
    height !== null &&
    width !== undefined &&
    width !== null &&
    depth !== undefined &&
    depth !== null;
  const resources = complex.resourcesHandled ?? [];

  return (
    <Stack as="ul" gap="xs" style={LIST_STYLE}>
      <Row>
        <RowName>Mass</RowName>
        <Text size="xs">
          {complex.massMax === undefined || complex.massMax === null ? (
            // RP-1 sends the float sentinel for "no limit", and the read side
            // turns that into absence. So absent here means UNLIMITED rather
            // than unanswered, and the null token would say the wrong thing.
            "unlimited"
          ) : (
            <>
              <Unit value={complex.massMin} /> to{" "}
              <Unit value={complex.massMax} />
            </>
          )}
        </Text>
      </Row>
      <Row>
        <RowName>Size</RowName>
        <Text size="xs">
          {sized ? (
            <>
              <Unit value={depth} /> × <Unit value={width} /> ×{" "}
              <Unit value={height} />
            </>
          ) : (
            "unlimited"
          )}
        </Text>
      </Row>
      <Row>
        <RowName>Resources</RowName>
        <Text size="xs">
          {resources.length === 0 ? "none" : resources.join(", ")}
        </Text>
      </Row>
    </Stack>
  );
}

/** What the complex draws per day, crew and structure kept apart because they move for different reasons. */
function Costs({ complex }: Readonly<{ complex: Rp1ComplexEntry }>) {
  return (
    <Text size="xs" tone="muted">
      crew <Unit value={complex.salaryPerDay} /> · complex{" "}
      <Unit value={complex.upkeepPerDay} />
    </Text>
  );
}

/**
 * Rush mode.
 *
 * <para>The control lives here rather than beside the vehicles because RP-1
 * keeps <c>IsRushing</c> on the COMPLEX: every project inside it is rushed
 * together, integrations and rollouts and reconditionings alike, so a control
 * shaped like "rush this build" would be a lie about what the game does.</para>
 *
 * <para>What it does to a complex is read off {@link RushStatus} once it is
 * running. The press itself names the salary in its accessible name, so a
 * screen-reader user is not asked to commit to a price they cannot see.</para>
 */
function RushControl({
  complex,
  name,
  handle,
}: Readonly<{
  complex: Rp1ComplexEntry;
  name: string;
  handle: Parameters<typeof CommandButton>[0]["handle"];
}>) {
  const lcId = complex.lcId;
  if (lcId === undefined || lcId === null) {
    return null;
  }
  const rushing = complex.isRushing === true;

  return (
    <CommandButton
      active={rushing}
      args={{ lcId, rushing: !rushing }}
      aria-label={
        rushing
          ? `Stop rushing work at ${name}`
          : `Rush work at ${name}, at double the salary`
      }
      commandLabel={rushing ? `Stop rushing ${name}` : `Rush ${name}`}
      handle={handle}
      label={rushing ? "Stop rushing" : "Rush"}
      size="sm"
      tone={rushing ? "warn" : "neutral"}
    />
  );
}

/**
 * A `Row` renders an `<li>`, so the label/value blocks above need list semantics
 * around them; see the host widget for the same reset and why it is inline.
 */
const LIST_STYLE = { listStyle: "none", margin: 0, padding: 0 } as const;
