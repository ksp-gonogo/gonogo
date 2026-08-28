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
  Unit,
  UnitInput,
} from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import type { Rp1ComplexEntry, Rp1PadEntry } from "../__generated__/contract";

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
  assign,
  rush,
}: Readonly<{
  complex: Rp1ComplexEntry;
  centreName: string;
  /** The centre's free pool, which is the ceiling on what this crew can grow by. */
  unassigned: number | null;
  pads: readonly Rp1PadEntry[];
  assign: Parameters<typeof CommandButton>[0]["handle"];
  rush: Parameters<typeof CommandButton>[0]["handle"];
}>) {
  const name = complex.name ?? NULL_DISPLAY;
  const engineers = magnitudeOf(complex.engineers);
  const maxEngineers = magnitudeOf(complex.maxEngineers);
  const operational = complex.isOperational === true;
  const unstaffed = operational && engineers === 0;

  return (
    <Card as="li" tone={unstaffed ? "warning" : operational ? "go" : "default"}>
      <Stack gap="sm">
        <Cluster gap="xs" wrap>
          <Text weight="semibold">{name}</Text>
          <Inline gap="xs">
            {complex.humanRated === true && (
              <Badge severity="info">HUMAN-RATED</Badge>
            )}
            {complex.isRushing === true && (
              <Badge severity="caution">RUSHING</Badge>
            )}
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
            complex={complex}
            engineers={engineers}
            handle={assign}
            maxEngineers={maxEngineers}
            name={name}
            unassigned={unassigned}
          />
        )}

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
 * The one control that changes who works here.
 *
 * <para>A TARGET rather than a step, sent as a set: an operator commanding from
 * a remote vantage is reading a crew count as it was, and "+5" applied to a
 * count that has since moved lands somewhere nobody chose. The field is bounded
 * by what RP-1 would actually accept, which is the complex's own ceiling and
 * what the centre has free, so the control offers no number the command would
 * refuse.</para>
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
  name,
  handle,
}: Readonly<{
  complex: Rp1ComplexEntry;
  engineers: number | null;
  maxEngineers: number | null;
  unassigned: number | null;
  name: string;
  handle: Parameters<typeof CommandButton>[0]["handle"];
}>) {
  const [target, setTarget] = useState<number | null>(null);
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

  const ceiling =
    unassigned === null
      ? maxEngineers
      : Math.min(maxEngineers, engineers + Math.max(0, unassigned));
  const wanted = target ?? engineers;

  return (
    <Cluster align="start" gap="xs" wrap>
      <UnitInput
        label={`Crew for ${name}`}
        onChange={(next) => setTarget(magnitudeOf(next))}
        range={{ max: ceiling, min: 0, step: 1 }}
        unit="count"
        value={value("count", wanted)}
      />
      <CommandButton
        args={{ engineers: wanted, lcId }}
        aria-label={`Leave ${wanted} engineers at ${name}`}
        commandLabel={`Assign ${wanted} engineers to ${name}`}
        disabled={wanted === engineers}
        handle={handle}
        label="Assign"
        size="sm"
      />
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
 * <para>What it COSTS is stated once for the section rather than on every card.
 * The terms are career-wide settings, so a copy per complex was the same
 * sentence four times over and read as a defect rather than as care; the same
 * correction the funds balance already got in this widget.</para>
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
