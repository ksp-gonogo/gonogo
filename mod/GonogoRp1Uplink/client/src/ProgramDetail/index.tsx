import type { Reading } from "@ksp-gonogo/sitrep-sdk";
import { registerAugment, useTelemetry, value } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Cluster,
  DataTable,
  Disclosure,
  EmptyState,
  GraphNotice,
  LineGraph,
  MissionDate,
  magnitudeOf,
  NULL_DISPLAY,
  Readout,
  ReadoutCaption,
  Row,
  RowName,
  Section,
  SectionTitle,
  SelectableRow,
  type Severity,
  Stack,
  Text,
  Unit,
} from "@ksp-gonogo/ui-kit";
import { useMemo, useState } from "react";
import type {
  Rp1FundingCurveEntry,
  Rp1ProgramEntry,
  Rp1ProgramPaymentEntry,
  Rp1ProgramSpeedOption,
} from "../__generated__/contract";
import { PROGRAMS_SCREEN_ID } from "../AdminBuilding/programsScreen";
import { RP1 } from "../uplink";
import "../topics";
import {
  type FundingCurveSample,
  plainCurveKeys,
  sampleFundingCurve,
} from "./fundingCurve";

/**
 * One RP-1 Program in full: what it asks, what it pays, when, and what
 * accepting it costs and closes off.
 *
 * <para>The BODY of the Administration Building's Programs screen, contributed
 * as an augment on `strategies.screen-body`. It was a standalone widget until
 * the building grew screens, which made a second Programs surface out of the
 * one the operator already opens the building for. The strategy cards above it
 * on that screen carry the Activate and Deactivate verbs; this is the half that
 * says what accepting one costs and pays.</para>
 *
 * <para>The Administration building's own detail panel, minus the prose. RP-1
 * shows this as a rich-text blob with the figures formatted into sentences;
 * everything here is read from RP-1's model as data instead, so the funding
 * curve arrives as a curve rather than as a picture of one and the per-year
 * schedule as rows rather than as a list of strings.</para>
 *
 * <para>The curve is the half that decides planning. Two Programs paying the
 * same total over the same years pay it in very different shapes: a
 * StrongFrontloaded Program funds a launch campaign in its first two years and
 * then thins out, a StrongBackloaded one leaves the career short until its
 * fourth. The total alone cannot tell those apart, and it is the number every
 * other surface shows.</para>
 */
export function ProgramDetail({ screenId }: { screenId: string }) {
  const available = current(useTelemetry("rp1.available"));
  const programs = current(useTelemetry("rp1.programs"));
  const slots = current(useTelemetry("rp1.programSlots"));
  const curves = current(useTelemetry("rp1.programFundingCurves"));
  // Both balances, because both are spent here. Confidence buys the Program and
  // funds are what it pays back, so an operator weighing an offer is comparing
  // a price they hold in one currency against income in another; making them
  // leave the widget for either half is making them weigh it wrong.
  const confidence = current(useTelemetry("rp1.confidence"));
  const career = current(useTelemetry("career.status"));

  const [picked, setPicked] = useState<string | null>(null);

  const rows = programs ?? [];
  const chosen = choose(rows, picked ?? "");

  /* One screen of the building, and not the others it may grow. */
  if (screenId !== PROGRAMS_SCREEN_ID) {
    return null;
  }

  // Invisible without RP-1 rather than an empty section on a stock game.
  if (available !== true) {
    return null;
  }

  return (
    <Section>
      {/*
        The Program on screen sits BESIDE the section's own heading rather than
        under it as a second one, which is the operator's "a 'Program' header
        directly under it... it should actually use the aside UI". It is the
        aside's shape and deliberately not `Panel`'s own `aside` prop: this
        augment draws into the Administration building's scrolling body and owns
        no panel to hang one on, and a panel narrow enough to collapse its aside
        would fold away the name of the thing every row below is about. The
        collapse is why VehicleAssembly keeps its funds line in the body.
      */}
      <Cluster gap="sm" wrap>
        <SectionTitle>PROGRAM DETAIL</SectionTitle>
        {chosen !== undefined && (
          /* Wrapping in its own right, not just as one item of the row above.
             The badge and a Program's title are two items and RP-1's titles run
             long ("Sounding Rocket Development"): as a single unbreakable item
             the pair overflowed the panel's own width at the sizes this screen
             draws at, which the readability probe reads as text an operator
             cannot see. `justify="start"` because it is a subject, not a row to
             be spread. */
          <Cluster gap="xs" justify="start" wrap>
            <Badge severity={severityOf(chosen.state)}>
              {(chosen.state ?? NULL_DISPLAY).toUpperCase()}
            </Badge>
            <Text weight="semibold">{label(chosen)}</Text>
          </Cluster>
        )}
      </Cluster>
      <Stack gap="md">
        <ProgramPicker chosen={chosen} onPick={setPicked} programs={rows} />

        {/* Wrapping, because three readouts do not fit across a narrow
            panel and a Cluster that cannot wrap pushes the third one past
            the panel's edge with no scroller to recover it. */}
        <Cluster gap="md" wrap>
          <Readout>
            <ReadoutCaption>Funds</ReadoutCaption>
            <Unit value={career?.economy?.funds} />
          </Readout>
          <Readout>
            <ReadoutCaption>Confidence</ReadoutCaption>
            <Unit value={confidence?.confidence} />
          </Readout>
          <Readout>
            <ReadoutCaption>Slots</ReadoutCaption>
            <Text>
              <Unit value={slots?.usedSlots} /> of{" "}
              <Unit value={slots?.maxSlots} />
            </Text>
          </Readout>
        </Cluster>

        {chosen === undefined ? (
          /*
           * Two states reach here and neither is "this Program has no detail":
           * RP-1 is present (checked above) and the catalogue has either not
           * arrived yet or arrived empty. Both leave nothing to describe, which
           * is the one case worth a line: the surface is unreadable rather than
           * empty.
           */
          <EmptyState>RP-1 has not sent a Program catalogue</EmptyState>
        ) : (
          <ChosenProgram
            program={chosen}
            curves={curves}
            confidenceHeld={magnitudeOf(confidence?.confidence)}
          />
        )}
      </Stack>
    </Section>
  );
}

/**
 * The catalogue, as a list of rows the operator picks from.
 *
 * <para>Not a dropdown, on the operator's ruling that "the active program should
 * not be a dropdown". A <c>select</c> shows one entry at a time and hides the
 * state of every other, so an operator could not see that the Program paying the
 * career is running, which of the rest are acceptable and which are locked
 * without opening it and reading forty entries one at a time. Each row carries
 * its state, so the catalogue is scannable.</para>
 *
 * <para>Behind an expander because it is reference: the detail opens on the
 * running Program, which is the one worth reading, and RP-1's catalogue is long
 * enough that a standing list would push every reading below it off the screen.
 * The panel caps its own height and scrolls, which is what the kit's inline
 * disclosure does.</para>
 *
 * <para>Absent entirely with no catalogue to pick from: a picker offering the
 * null token is a control that cannot be used.</para>
 */
function ProgramPicker({
  chosen,
  onPick,
  programs,
}: Readonly<{
  chosen: Rp1ProgramEntry | undefined;
  onPick: (name: string) => void;
  programs: readonly Rp1ProgramEntry[];
}>) {
  if (programs.length === 0) {
    return null;
  }
  return (
    <Disclosure
      ariaLabel="Choose a Program"
      asButton
      buttonSize="sm"
      chevron={false}
      label={(open: boolean) => (open ? "Hide programs" : "Choose program")}
      panelHeight="cap"
      variant="inline"
    >
      <Stack gap="xs">
        {ordered(programs).map((program) => (
          <SelectableRow
            key={program.name ?? ""}
            onClick={() => onPick(program.name ?? "")}
            selected={program.name === chosen?.name}
          >
            <Cluster gap="xs" wrap>
              <Text size="xs">{label(program)}</Text>
              <Badge severity={severityOf(program.state)}>
                {(program.state ?? NULL_DISPLAY).toUpperCase()}
              </Badge>
            </Cluster>
          </SelectableRow>
        ))}
      </Stack>
    </Disclosure>
  );
}

/** Everything about the Program the operator picked. */
function ChosenProgram({
  program,
  curves,
  confidenceHeld,
}: Readonly<{
  program: Rp1ProgramEntry;
  curves: readonly Rp1FundingCurveEntry[] | undefined;
  confidenceHeld: number | null;
}>) {
  const closes = program.programsToDisableOnAccept ?? [];
  return (
    <Stack gap="md">
      {/* No heading of its own: the section's title row names this Program and
          carries its state badge, and repeating either here is the stacked
          heading the operator objected to. */}
      <Section>
        <Stack as="ul" gap="xs" style={LIST_STYLE}>
          <Row>
            <RowName>Speed</RowName>
            <Text>{program.speed ?? NULL_DISPLAY}</Text>
          </Row>
          <Row>
            <RowName>Slots taken</RowName>
            <Text>
              <Unit value={program.slots} />
            </Text>
          </Row>
          <Row>
            <RowName>Duration</RowName>
            <Text>
              <Unit value={program.durationSeconds} />
            </Text>
          </Row>
        </Stack>
      </Section>

      {present(program.objectivesText) !== undefined && (
        <Section>
          <SectionTitle>OBJECTIVES</SectionTitle>
          <Text>{program.objectivesText}</Text>
        </Section>
      )}

      {present(program.requirementsText) !== undefined && (
        <Section>
          {/* RP-1 shows the requirements only on a Program not yet accepted,
              because on a running one they are history. The row follows: the
              Uplink leaves the field absent once a Program is accepted. */}
          <SectionTitle>REQUIREMENTS</SectionTitle>
          <Text>{program.requirementsText}</Text>
        </Section>
      )}

      <Section>
        <SectionTitle>FUNDING</SectionTitle>
        <Stack as="ul" gap="xs" style={LIST_STYLE}>
          <Row>
            <RowName>Total</RowName>
            <Text>
              <Unit value={program.totalFunding} />
            </Text>
          </Row>
          <Row>
            <RowName>Paid out</RowName>
            <Text>
              <Unit value={program.fundsPaidOut} />
            </Text>
          </Row>
          <Row>
            <RowName>Remaining</RowName>
            <Text>
              <Unit value={program.fundsRemaining} />
            </Text>
          </Row>
          <Row>
            <RowName>Curve</RowName>
            <Text>{curveName(program, curves)}</Text>
          </Row>
          <Row>
            <RowName>
              {present(program.completedUt) === undefined
                ? "Deadline"
                : "Completed"}
            </RowName>
            <Text>
              <MissionDateOrAbsent
                ut={program.completedUt ?? program.deadlineUt}
              />
            </Text>
          </Row>
          <Row>
            <RowName>Accepted</RowName>
            <Text>
              <MissionDateOrAbsent ut={program.acceptedUt} />
            </Text>
          </Row>
        </Stack>
      </Section>

      <FundingCurveChart program={program} curves={curves} />

      <PaymentSchedule payments={program.fundingPayments} />

      <SpeedLadder
        options={program.speedOptions}
        chosen={program.speed}
        confidenceHeld={confidenceHeld}
      />

      {closes.length > 0 && (
        <Section>
          {/* The cost in neither currency. A rival Program taken off the table
              is funding the career can never draw, and nothing else on any
              screen says so before the decision is made. */}
          <SectionTitle>CLOSES OFF ON ACCEPT</SectionTitle>
          <Stack as="ul" gap="xs" style={LIST_STYLE}>
            {closes.map((name) => (
              <Row key={name}>
                <RowName>{name}</RowName>
                <Text />
              </Row>
            ))}
          </Stack>
        </Section>
      )}
    </Stack>
  );
}

/**
 * The funding curve, drawn.
 *
 * <para>Three outcomes and they are three different facts. A sampled curve
 * draws. A Program whose curve or total could not be read draws NOTHING and
 * says which, because a flat line along the bottom of a funds axis is a claim
 * that the Program pays nothing and that is a different Program. A Program with
 * no readable duration draws on the curve's own fraction-of-duration axis and
 * labels it as fractions, because the shape survives the missing conversion
 * even though the calendar does not.</para>
 */
function FundingCurveChart({
  program,
  curves,
}: Readonly<{
  program: Rp1ProgramEntry;
  curves: readonly Rp1FundingCurveEntry[] | undefined;
}>) {
  const sample = useMemo<FundingCurveSample | null>(
    () =>
      sampleFundingCurve({
        keys: plainCurveKeys(resolveCurve(program, curves)?.keys),
        totalFunds: magnitudeOf(program.totalFunding),
        durationSeconds: magnitudeOf(program.durationSeconds),
      }),
    [program, curves],
  );

  const paidOut = magnitudeOf(program.fundsPaidOut);
  /*
   * RP-1's own Program screen plots the change in funds per YEAR, and this
   * matches it. The cumulative series only ever rises, so its shape carries one
   * bit and the front- or back-loading that separates one Program speed from
   * another shows only as a change of slope; the rate shows it directly, and
   * the cumulative figures stay in the table below.
   *
   * Falls back to cumulative when the sample could not state a rate, which is
   * when RP-1 published no duration and the axis is fractions of the term.
   */
  const perYear =
    sample !== null && sample.points.some((p) => p.fundsPerYear !== null);

  return (
    <Section>
      <SectionTitle>FUNDING CURVE</SectionTitle>
      {sample === null ? (
        <GraphNotice placement="inline">
          {present(curves) === undefined
            ? "RP-1 has not sent its funding-curve table"
            : "no funding curve for this Program"}
        </GraphNotice>
      ) : (
        <Stack gap="xs">
          <LineGraph
            height={140}
            ariaLabel={
              perYear
                ? `Funding per year over the duration of ${label(program)}`
                : `Cumulative funding over the duration of ${label(program)}`
            }
            series={[
              {
                id: "funding",
                label: perYear ? "Funding per year" : "Cumulative funding",
                color: "var(--color-status-go-fg)",
                points: sample.points.map((p) => ({
                  x: p.x,
                  y: perYear ? (p.fundsPerYear ?? 0) : p.funds,
                })),
              },
            ]}
            // The deadline, as a rule across the chart. Everything right of
            // where the curve crosses it is money RP-1 pays for running over,
            // which is the single thing an operator reads this chart for.
            /*
             * The paid-so-far rule is a CUMULATIVE total, so it belongs only on
             * the cumulative chart: drawn against a rate axis it would be a
             * funds figure compared with a funds-per-year one, which is a
             * category error that happens to render.
             */
            thresholds={
              perYear || paidOut === null
                ? []
                : [{ id: "paid", label: "Paid out", value: paidOut }]
            }
          />
          {/* Axis labels as HTML beside the drawing rather than text inside the
              stretched viewBox: `Unit` renders the quantity with its own ladder
              and its own screen-reader wording, and a <text> element in a
              non-uniformly scaled SVG would be stretched with it. */}
          <Cluster gap="sm" wrap>
            {/* The anchors describe the SERIES, so they change with it: a rate
                chart does not start at zero funds and does not end at the
                total, which is what the cumulative one is bounded by. */}
            <Text size="xs" tone="muted">
              {perYear ? (
                <>funds per year across the term</>
              ) : (
                <>
                  <Unit value={value("funds", 0)} /> at start
                </>
              )}
            </Text>
            <Text size="xs" tone="muted">
              {sample.axis === "years" ? (
                <>
                  full term <Unit value={program.durationSeconds} />
                </>
              ) : (
                <>axis in fractions of the term, which RP-1 has not published</>
              )}
            </Text>
            <Text size="xs" tone="muted">
              <Unit value={program.totalFunding} />{" "}
              {perYear ? <>in total</> : <>at term</>}
            </Text>
          </Cluster>
          {!perYear && paidOut !== null && (
            <Text size="xs" tone="muted">
              Dashed rule: <Unit value={program.fundsPaidOut} /> paid so far
            </Text>
          )}
        </Stack>
      )}
    </Section>
  );
}

/** RP-1's own Funding Summary: what each nominal year pays. */
function PaymentSchedule({
  payments,
}: Readonly<{ payments: readonly Rp1ProgramPaymentEntry[] | undefined }>) {
  const schedule = present(payments);
  if (schedule === undefined) {
    // Absent is RP-1's own answer on a completed Program, and it is the right
    // one: a table of what a finished Program once would have paid reads as
    // money still coming. Saying nothing here is saying that.
    return null;
  }
  return (
    <Section>
      <SectionTitle>FUNDING SUMMARY</SectionTitle>
      <DataTable
        caption="Funding paid per nominal year of this Program"
        rows={schedule as Rp1ProgramPaymentEntry[]}
        rowKey={(row) => String(magnitudeOf(row.year) ?? "")}
        columns={[
          {
            key: "year",
            header: "Nominal year",
            render: (row) => <Unit value={row.year} />,
            minWidth: "12ch",
          },
          {
            key: "funds",
            header: "Pays",
            align: "end",
            render: (row) => <Unit value={row.funds} />,
            minWidth: "10ch",
          },
          {
            key: "cumulative",
            header: "Cumulative",
            align: "end",
            render: (row) => <Unit value={row.cumulativeFunds} />,
            minWidth: "10ch",
          },
        ]}
      />
    </Section>
  );
}

/**
 * The three speeds, priced. Present on an accepted Program too, where it is the
 * table the choice was made from: RP-1 fixes speed at accept.
 */
function SpeedLadder({
  options,
  chosen,
  confidenceHeld,
}: Readonly<{
  options: readonly Rp1ProgramSpeedOption[] | undefined;
  chosen: Rp1ProgramEntry["speed"];
  confidenceHeld: number | null;
}>) {
  const ladder = present(options);
  if (ladder === undefined || ladder.length === 0) {
    return null;
  }
  return (
    <Section>
      <SectionTitle>SPEED</SectionTitle>
      <DataTable
        caption="Confidence price and duration at each speed this Program can be accepted at"
        rows={ladder as Rp1ProgramSpeedOption[]}
        rowKey={(row) => row.speed ?? ""}
        columns={[
          {
            key: "speed",
            header: "Speed",
            render: (row) => (
              <Text>
                {row.speed ?? NULL_DISPLAY}
                {row.speed === chosen && (
                  <>
                    {" "}
                    <Badge severity="info">SELECTED</Badge>
                  </>
                )}
              </Text>
            ),
            minWidth: "14ch",
          },
          {
            key: "confidence",
            header: "Confidence",
            align: "end",
            render: (row) => (
              <Text>
                <Unit value={row.confidenceCost} />
                {outOfReach(row.confidenceCost, confidenceHeld) && (
                  <>
                    {" "}
                    <Badge severity="caution">SHORT</Badge>
                  </>
                )}
              </Text>
            ),
            minWidth: "12ch",
          },
          {
            key: "duration",
            header: "Term",
            align: "end",
            render: (row) => <Unit value={row.durationSeconds} />,
            minWidth: "10ch",
          },
        ]}
      />
    </Section>
  );
}

/**
 * A date, or the absence of one said out loud. RP-1 recomputes a deadline on its
 * own funding tick, so a Program accepted and not yet funded genuinely has none;
 * a date we made up would be worse than the gap.
 */
function MissionDateOrAbsent({
  ut,
}: Readonly<{ ut: Rp1ProgramEntry["deadlineUt"] }>) {
  if (ut === undefined || ut === null) {
    return <>{NULL_DISPLAY} not set</>;
  }
  return <MissionDate value={ut} />;
}

/** A Row renders an `<li>`; see ProgramStatus for the same reset and why it is inline. */
const LIST_STYLE = { listStyle: "none", margin: 0, padding: 0 } as const;

/**
 * The Program to show: the operator's pick when it still exists, else the first
 * running one, else the first row. Falling back to running rather than to the
 * catalogue's first entry is what makes an unconfigured instance useful: the
 * Program paying the career is the one worth opening on.
 */
function choose(
  rows: readonly Rp1ProgramEntry[],
  wanted: string,
): Rp1ProgramEntry | undefined {
  const named = rows.find((p) => p.name === wanted && wanted !== "");
  if (named !== undefined) return named;
  return rows.find((p) => p.state === "active") ?? ordered(rows)[0];
}

/**
 * Running Programs first, then what could be accepted, then the rest. The
 * picker is a list an operator scans, and RP-1's own catalogue order puts a
 * locked Program from the 1980s above the one paying the career today.
 */
function ordered(rows: readonly Rp1ProgramEntry[]): Rp1ProgramEntry[] {
  const rank = (state: Rp1ProgramEntry["state"]) => {
    if (state === "active") return 0;
    if (state === "offerable") return 1;
    if (state === "completed") return 2;
    return 3;
  };
  return [...rows].sort(
    (a, b) => rank(a.state) - rank(b.state) || label(a).localeCompare(label(b)),
  );
}

function label(program: Rp1ProgramEntry): string {
  return program.title ?? program.name ?? NULL_DISPLAY;
}

/**
 * The curve a Program is paid on, resolving RP-1's own fallback: its settings
 * return the default curve for a name they do not hold as well as for no name,
 * so a Program naming nothing is paid on the default rather than on none.
 */
function resolveCurve(
  program: Rp1ProgramEntry,
  curves: readonly Rp1FundingCurveEntry[] | undefined,
): Rp1FundingCurveEntry | undefined {
  const table = present(curves);
  if (table === undefined) return undefined;
  const wanted = present(program.fundingCurve);
  const named =
    wanted === undefined
      ? undefined
      : table.find((c) => present(c.name) === wanted);
  return named ?? table.find((c) => c.isDefault === true);
}

/** The curve's name as shown, saying so when it is the fallback rather than the Program's own. */
function curveName(
  program: Rp1ProgramEntry,
  curves: readonly Rp1FundingCurveEntry[] | undefined,
): string {
  const named = present(program.fundingCurve);
  if (named !== undefined) return named;
  const fallback = present(resolveCurve(program, curves)?.name);
  if (fallback !== undefined) return `${fallback} (default)`;
  return NULL_DISPLAY;
}

/**
 * A wire field's value, or undefined for either kind of absence.
 *
 * <para>JSON has no undefined, so an absent field arrives as `null` while the
 * generated types spell it `?:` and TypeScript reads that as `| undefined`. A
 * bare `!== undefined` therefore passes on every absent field on this wire, and
 * the failure is silent in the worst direction: the widget goes on to render a
 * section about a fact it does not have.</para>
 */
function present<T>(field: T | null | undefined): T | undefined {
  return field ?? undefined;
}

/** How a state reads at a glance. */
function severityOf(state: Rp1ProgramEntry["state"]): Severity {
  if (state === "active") return "info";
  if (state === "disabled") return "caution";
  return "nominal";
}

/**
 * The career cannot afford this speed. Silent unless BOTH halves are present:
 * an unknown balance is not a short one and a price we could not read is not
 * free. Deliberately not RP-1's own verdict, for the reason ProgramStatus gives:
 * RP-1 decides affordability with a query that broadcasts to every modifier in
 * the save, which the Uplink does not run.
 */
function outOfReach(
  cost: Rp1ProgramSpeedOption["confidenceCost"],
  held: number | null,
): boolean {
  const price = magnitudeOf(cost);
  return price !== null && held !== null && held < price;
}

/** The value where one is current; see ProgramStatus for why reckonable counts. */
function current<T>(reading: Reading<T>): T | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "reckonable") return reading.reckoned.value;
  return undefined;
}

registerAugment({
  id: "rp1-program-detail",
  augments: "strategies.screen-body",
  component: ProgramDetail,
  channels: [
    "rp1.available",
    "rp1.programs",
    "rp1.programSlots",
    "rp1.programFundingCurves",
    "rp1.confidence",
    /* The spend rule: this quotes a Confidence price against a funds return,
       so both balances have to be in it. The host carries `career.status`
       already, and naming it here is what makes that independent of the host. */
    "career.status",
  ],
  requires: "rp1",
  owner: RP1,
});
