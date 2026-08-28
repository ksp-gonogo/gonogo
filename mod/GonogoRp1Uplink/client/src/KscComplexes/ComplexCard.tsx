import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Card,
  Cluster,
  CommandButton,
  Inline,
  magnitudeOf,
  NULL_DISPLAY,
  ProgressBar,
  Stack,
  Text,
  ToggleButton,
  Unit,
} from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import type {
  Rp1ComplexEntry,
  Rp1PadEntry,
  Rp1RushTerms,
} from "../__generated__/contract";

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
  unassigned,
  pads,
  terms,
  assign,
  rush,
}: Readonly<{
  complex: Rp1ComplexEntry;
  centreName: string;
  /** The centre's free pool, which is the ceiling on what this crew can grow by. */
  unassigned: number | null;
  pads: readonly Rp1PadEntry[];
  terms: Rp1RushTerms | undefined;
  assign: Parameters<typeof CommandButton>[0]["handle"];
  rush: Parameters<typeof CommandButton>[0]["handle"];
}>) {
  const name = complex.name ?? NULL_DISPLAY;
  const engineers = magnitudeOf(complex.engineers);
  const maxEngineers = magnitudeOf(complex.maxEngineers);
  const operational = complex.isOperational === true;
  const rushing = complex.isRushing === true;
  const unstaffed = operational && engineers === 0;

  return (
    <Card as="li" tone={unstaffed ? "warning" : operational ? "go" : "default"}>
      <Stack gap="lg">
        <Cluster gap="xs" wrap>
          <Text weight="semibold">{name}</Text>
          <Inline gap="xs">
            {complex.humanRated === true && (
              <Badge severity="info">HUMAN-RATED</Badge>
            )}
            {rushing && <Badge severity="caution">RUSHING</Badge>}
            {operational ? null : (
              <Badge severity="offline">NOT YET BUILT</Badge>
            )}
          </Inline>
        </Cluster>

        {/* The line that answers "what am I looking at". A complex, of a kind,
            at a named centre, and not one of the career-wide facilities. */}
        <Text size="xs" tone="muted">
          {complex.lcType === "Hangar" ? "hangar complex" : "pad complex"} at{" "}
          {centreName}
        </Text>

        <Crew
          complex={complex}
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

        {rushing && <RushStatus terms={terms} />}

        <Envelope complex={complex} />
        <Costs complex={complex} />
        <Pads pads={pads} />

        {operational && (
          <RushControl complex={complex} handle={rush} name={name} />
        )}
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
  engineers,
  maxEngineers,
  name,
}: Readonly<{
  complex: Rp1ComplexEntry;
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
      {share === null ? null : (
        <ProgressBar
          ariaLabel={`Crew assigned to ${name}, as a share of what it can hold`}
          value={share * 100}
        />
      )}
      {engineers === 0 && (
        <Text size="xs" tone="muted">
          <Badge severity="caution">NOBODY ASSIGNED</Badge> nothing here
          advances until someone is
        </Text>
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
        {NULL_DISPLAY} RP-1 has not said how many engineers this complex holds,
        so there is nothing to move
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
      <Cluster align="start" gap="sm" wrap>
        <Inline
          aria-label={`Engineers moved per press at ${name}`}
          gap="xs"
          role="group"
        >
          {STEPS.map((option) => (
            <ToggleButton
              active={step === option}
              key={String(option)}
              onClick={() => setStep(option)}
              size="sm"
            >
              {option === "all" ? "ALL" : option}
            </ToggleButton>
          ))}
        </Inline>
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
            label={shrink === 0 ? "−" : `−${shrink}`}
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
            label={grow === 0 ? "+" : `+${grow}`}
            size="sm"
          />
        </Inline>
      </Cluster>

      {/* The two limits, at opposite ends of the card, because they are two
          different things to go and fix: free somebody at the centre, or build
          this complex up. Read as one line they would be one ceiling. */}
      <Cluster gap="md" wrap>
        <Text size="xs" tone={free === 0 ? "warn" : "muted"}>
          free at {centreName}{" "}
          <Unit
            value={unassigned === null ? undefined : value("count", unassigned)}
          />
        </Text>
        <Text size="xs" tone={room === 0 ? "warn" : "muted"}>
          room here <Unit value={value("count", room)} />
        </Text>
      </Cluster>
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
  const resources = complex.resourcesHandled;

  return (
    <Text size="xs" tone="muted">
      takes{" "}
      {complex.massMax === undefined || complex.massMax === null ? (
        "any mass"
      ) : (
        <>
          <Unit value={complex.massMin} /> to <Unit value={complex.massMax} />
        </>
      )}
      {" · "}
      {sized ? (
        <>
          up to <Unit value={depth} /> × <Unit value={width} /> ×{" "}
          <Unit value={height} />
        </>
      ) : (
        "any size"
      )}
      {resources === undefined || resources === null ? null : (
        <>
          {" · "}
          {resources.length === 0
            ? "handles no resources"
            : `handles ${resources.join(", ")}`}
        </>
      )}
    </Text>
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
 * The complex's pads, each at its own level.
 *
 * <para>Named because a pad is where a complex's work ends up and its level is a
 * limit of its own, and because two pads at different levels is the state that
 * makes "the complex" and "the pad" different things. A complex with none is
 * said rather than skipped: for a pad-type complex that is a real and blocking
 * condition, and for a hangar it is normal.</para>
 */
function Pads({ pads }: Readonly<{ pads: readonly Rp1PadEntry[] }>) {
  if (pads.length === 0) {
    return (
      <Text size="xs" tone="muted">
        no pads
      </Text>
    );
  }
  return (
    <Text size="xs" tone="muted">
      pads{" "}
      {pads.map((pad, index) => (
        <span key={pad.padId ?? pad.name ?? String(index)}>
          {index === 0 ? "" : ", "}
          {pad.name ?? NULL_DISPLAY} at level <Unit value={pad.level} />
        </span>
      ))}
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
