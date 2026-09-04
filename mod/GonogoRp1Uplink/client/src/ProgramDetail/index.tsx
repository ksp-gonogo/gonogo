import type { Reading } from "@ksp-gonogo/sitrep-sdk";
import {
  registerAugment,
  useCommand,
  useTelemetry,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Cluster,
  CommandButton,
  DataTable,
  EmptyState,
  GraphNotice,
  Grid,
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
  usePanelDelay,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
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
 * Commit to a Program. Must match `Rp1StrategyCommands.ActivateCommand`.
 *
 * <para>It is the STRATEGY command and not a program-shaped one, because RP-1
 * makes leaders and Programs one class family: a "leader" is any strategy whose
 * department is not Programs, and the same procedure activates both.</para>
 */
export const RP1_STRATEGY_ACTIVATE_COMMAND = "rp1.strategy.activate";

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

  /* Unconditional and above the two early returns below: a hook after one would
     change count on the first frame RP-1 answers. */
  const accept = useCommand(RP1_STRATEGY_ACTIVATE_COMMAND);
  usePanelDelay(accept);

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
    <Section gap="md">
      <SectionTitle>PROGRAM DETAIL</SectionTitle>

      {/* Wrapping, because three balances do not fit across a narrow panel and
          a Cluster that cannot wrap pushes the third one past the panel's edge
          with no scroller to recover it.

          In the BODY rather than in a `Panel` aside: an aside collapses at
          narrow widths and would take the Confidence balance with it, and
          Confidence is what the Accept control below actually spends. */}
      <Cluster align="start" gap="md" justify="start" wrap>
        <Balance caption="Funds">
          <Unit value={career?.economy?.funds} />
        </Balance>
        <Balance caption="Confidence">
          <Unit value={confidence?.confidence} />
        </Balance>
        <Balance caption="Slots">
          <Unit value={slots?.usedSlots} /> of <Unit value={slots?.maxSlots} />
        </Balance>
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
        /*
         * ONE interface: the catalogue, and the detail of whatever is picked out
         * of it. Side by side while there is width for two panes, stacked when
         * there is not, on the same `auto-fit` + `minmax` mechanism `Panel`'s
         * own section grid uses; `min(...,100%)` clamps the track to the pane so
         * a narrow tile stacks rather than scrolling sideways.
         *
         * It was a catalogue hidden behind a "Choose program" button above a
         * standing detail, which is the browse half the operator could not find.
         * That also inverted the game's own Administration screen, where the
         * strategy list stands open beside the selected strategy's description
         * and its one accept control (`KSP.UI.Screens.Administration`:
         * `scrollListStrategies` + `SetSelectedStrategy` + `btnAcceptCancel`).
         */
        <Grid cols={MASTER_DETAIL_COLUMNS} gap="md" align="start">
          <ProgramCatalogue
            chosen={chosen}
            onPick={setPicked}
            programs={rows}
          />
          <ChosenProgram
            accept={accept}
            program={chosen}
            curves={curves}
            confidenceHeld={magnitudeOf(confidence?.confidence)}
          />
        </Grid>
      )}
    </Section>
  );
}

/**
 * One career balance: the caption OVER the figure rather than beside it.
 *
 * <para>The pair sat on one baseline, which needs the width of both at the
 * readout's 22px display size. At the Administration Building's own five-column
 * tile there is not that much room and the figure ran off the panel: a funds
 * balance clipped to "289,848" with the unit gone, on the surface whose whole
 * job is to price a commitment. Stacked, the row needs the width of the figure
 * alone and the caption line wraps if even that is tight.</para>
 */
function Balance({
  caption,
  children,
}: Readonly<{ caption: string; children: ReactNode }>) {
  return (
    <Stack gap="xs">
      <ReadoutCaption>{caption}</ReadoutCaption>
      <Readout>{children}</Readout>
    </Stack>
  );
}

/**
 * The two panes, and the shape that lets them sit side by side.
 *
 * <para>15rem is the floor for a Program's title beside its state badge; under
 * that the pair wraps and the catalogue reads as a ragged block. The detail
 * pane's own sections columnise separately at `Panel`'s own 13rem floor, so a
 * landscape tile ends up with the catalogue down one side and the readings
 * across the rest rather than as one endless column.</para>
 */
const MASTER_DETAIL_COLUMNS = "repeat(auto-fit, minmax(min(15rem, 100%), 1fr))";
const DETAIL_COLUMNS = "repeat(auto-fit, minmax(min(13rem, 100%), 1fr))";

/**
 * How tall the catalogue grows before it scrolls on its own.
 *
 * <para>An RP-1 career carries tens of Programs, and in the stacked layout the
 * catalogue sits above the detail: uncapped, it would push every reading the
 * operator opened this for off the bottom of the panel. The figure is the kit's
 * own inline-disclosure cap, which is what held this list while it was
 * hidden.</para>
 */
const CATALOGUE_SCROLL = { maxHeight: "16rem", overflowY: "auto" } as const;

/**
 * The catalogue: every Program RP-1 knows about, as rows the operator picks
 * from, standing open beside the detail of whichever one is picked.
 *
 * <para>Not a dropdown, on the operator's ruling that "the active program should
 * not be a dropdown". A <c>select</c> shows one entry at a time and hides the
 * state of every other, so an operator could not see that the Program paying the
 * career is running, which of the rest are acceptable and which are locked
 * without opening it and reading forty entries one at a time. Each row carries
 * its state, so the catalogue is scannable.</para>
 *
 * <para>And not behind an expander either, which is what it was: with the detail
 * standing open above a small "Choose program" button, the browse half of the
 * screen was something an operator had to already know was there. The list is
 * the half that says a choice exists at all, so it is the half that cannot be
 * hidden. It caps its own height and scrolls instead, which is what the
 * expander's panel was doing for it.</para>
 *
 * <para>The rows are buttons in a named group rather than an ARIA listbox: the
 * kit's pick-one row (`SelectableRow`, `aria-pressed`) is what every other
 * picker in the app is built from, and a roving-tabindex listbox is a primitive
 * the design system would have to own before an Uplink could use one.</para>
 */
function ProgramCatalogue({
  chosen,
  onPick,
  programs,
}: Readonly<{
  chosen: Rp1ProgramEntry | undefined;
  onPick: (name: string) => void;
  programs: readonly Rp1ProgramEntry[];
}>) {
  return (
    <Section gap="xs">
      <SectionTitle>CATALOGUE</SectionTitle>
      <Stack
        aria-label="Program catalogue"
        gap="xs"
        role="group"
        style={CATALOGUE_SCROLL}
      >
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
    </Section>
  );
}

/** Everything about the Program the operator picked. */
function ChosenProgram({
  accept,
  program,
  curves,
  confidenceHeld,
}: Readonly<{
  accept: Parameters<typeof CommandButton>[0]["handle"];
  program: Rp1ProgramEntry;
  curves: readonly Rp1FundingCurveEntry[] | undefined;
  confidenceHeld: number | null;
}>) {
  const closes = program.programsToDisableOnAccept ?? [];
  return (
    <Stack gap="md">
      {/* The pane's subject, named where the pane is. It sat beside the section
          heading while the catalogue was hidden and there was only ever one
          Program on screen; with the list standing open next to it, the name
          has to be on the detail or nothing says which row the readings belong
          to. `justify="start"` because it is a subject, not a row to be spread,
          and it wraps in its own right: RP-1's titles run long ("Sounding Rocket
          Development") and the badge-plus-title pair overflowed the panel as one
          unbreakable item. */}
      <Cluster gap="xs" justify="start" wrap>
        <Badge severity={severityOf(program.state)}>
          {(program.state ?? NULL_DISPLAY).toUpperCase()}
        </Badge>
        <Text weight="semibold">{label(program)}</Text>
      </Cluster>

      {/* Above the grid rather than in it: it is the one thing on this pane that
          SPENDS, so it keeps the full width of the pane and a fixed place
          directly under the Program it would accept, whatever the readings
          below it do at this width. */}
      <AcceptControl
        confidenceHeld={confidenceHeld}
        handle={accept}
        program={program}
      />

      {/* The readings, left to right when the pane is wide enough for two
          columns of them and stacked when it is not. */}
      <Grid cols={DETAIL_COLUMNS} gap="md" align="start">
        <Section>
          <SectionTitle>TERMS</SectionTitle>
          <Stack as="ul" gap="xs" style={LIST_STYLE}>
            <Row wrap>
              <RowName>Speed</RowName>
              <Text>{program.speed ?? NULL_DISPLAY}</Text>
            </Row>
            <Row wrap>
              <RowName>Slots taken</RowName>
              <Text>
                <Unit value={program.slots} />
              </Text>
            </Row>
            <Row wrap>
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
            <Row wrap>
              <RowName>Total</RowName>
              <Text>
                <Unit value={program.totalFunding} />
              </Text>
            </Row>
            <Row wrap>
              <RowName>Paid out</RowName>
              <Text>
                <Unit value={program.fundsPaidOut} />
              </Text>
            </Row>
            <Row wrap>
              <RowName>Remaining</RowName>
              <Text>
                <Unit value={program.fundsRemaining} />
              </Text>
            </Row>
            <Row wrap>
              <RowName>Curve</RowName>
              <Text>{curveName(program, curves)}</Text>
            </Row>
            <Row wrap>
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
            <Row wrap>
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
      </Grid>
    </Stack>
  );
}

/**
 * Accept this Program, at the speed RP-1 currently has selected.
 *
 * <para><b>The price is CONFIDENCE and it is charged in full at the press.</b>
 * `ProgramHandler.ActivateProgram` calls `Program.Accept()`, where the charge
 * and the deadline both live, so this is an up-front purchase and not a drain
 * like a construction. Funds run the other way entirely: a Program PAYS the
 * career, on the curve above. Both balances are drawn at the head of this
 * section for exactly that reason, and the Confidence one is the one this
 * control spends.</para>
 *
 * <para><b>The speed is RP-1's, not the operator's.</b> Speed fixes both the
 * term and the Confidence price and RP-1 fixes it at accept from whatever the
 * Administration building has selected. No command on this Uplink can set it, so
 * the control names the speed it would accept at rather than implying a choice
 * that is not on offer, and the ladder below prices the alternatives.</para>
 *
 * <para><b>Dark on state rather than on the press.</b> `canAccept` is RP-1's own
 * reading of everything but the money: not already active, not completed, not
 * ruled out by a rival, requirements met. The Confidence comparison is the half
 * RP-1 leaves to the client, because it makes that check with a broadcast query,
 * and it is the same comparison the speed ladder marks SHORT with. Both refuse
 * here with the reason on the control, and RP-1's own
 * `ProgramStrategy.CanActivate` asks all of it again at the press, so a stale
 * view cannot spend anything.</para>
 */
function AcceptControl({
  confidenceHeld,
  handle,
  program,
}: Readonly<{
  confidenceHeld: number | null;
  handle: Parameters<typeof CommandButton>[0]["handle"];
  program: Rp1ProgramEntry;
}>) {
  /* Nothing at all for a Program that is not an offer. A dark Accept on the
     Program already paying the career says nothing an operator can act on, and
     the state badge beside the section title already says which it is. */
  if (program.canAccept !== true) {
    return null;
  }

  const short = outOfReach(program.confidenceCost, confidenceHeld);
  const name = label(program);

  return (
    <Section>
      <SectionTitle>ACCEPT</SectionTitle>
      <Cluster gap="sm" justify="start" wrap>
        <Text size="sm" tone="muted">
          {program.confidenceCost == null ? (
            <>{NULL_DISPLAY} RP-1 did not price this Program</>
          ) : (
            <>
              <Unit value={program.confidenceCost} /> at{" "}
              {program.speed ?? NULL_DISPLAY} speed
            </>
          )}
          {short && (
            <>
              {" "}
              <Badge severity="caution">SHORT</Badge>
            </>
          )}
        </Text>
        <CommandButton
          args={{ strategyId: program.name }}
          /* Named while it can act, and the bare label once it cannot: a
             refused control announcing the acceptance it would have made
             describes something that will not happen. */
          aria-label={short ? undefined : `Accept ${name}`}
          commandLabel={`Accept ${name}`}
          confirmAriaLabel={`Confirm accepting ${name}`}
          confirmLabel={<AcceptWording cost={program.confidenceCost} />}
          disabled={short}
          handle={handle}
          label="Accept"
          size="sm"
          title={
            short
              ? "RP-1 charges the whole Confidence price when the Program is accepted, and the career is short of it"
              : undefined
          }
        />
      </Cluster>
    </Section>
  );
}

/**
 * What the confirm press spends.
 *
 * <para>A price RP-1 did not send is the null dash rather than a zero, and the
 * press is still offered: `ProgramStrategy.CanActivate` reads the threshold
 * itself and refuses with the figure if it really cannot be met.</para>
 */
function AcceptWording({
  cost,
}: Readonly<{ cost: Rp1ProgramEntry["confidenceCost"] }>) {
  if (cost == null) {
    return <>Spend {NULL_DISPLAY}</>;
  }
  return (
    <>
      Spend <Unit value={cost} />
    </>
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
            /* "Year", not "Nominal year". The caption above already says which
               calendar these are counted on, and the longer header was the
               widest thing in the table: it held all three columns 6ch wider
               than the readings need and pushed "Cumulative" into the table's
               own horizontal scroller at the Administration Building's narrower
               tiles. */
            key: "year",
            header: "Year",
            render: (row) => <Unit value={row.year} />,
            minWidth: "6ch",
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
            /* The speeds are one short word each ("Slow", "Normal", "Fast");
               the floor only has to hold the widest of them beside its SELECTED
               badge, which wraps under it. */
            minWidth: "9ch",
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
            /* The header is the widest thing in this column: the prices are
               three digits and the SHORT badge wraps under them. */
            minWidth: "10ch",
          },
          {
            key: "duration",
            header: "Term",
            align: "end",
            render: (row) => <Unit value={row.durationSeconds} />,
            /* "9y 183d" is the widest term RP-1 offers and the header is
               shorter than that, so 8ch is the column and 10ch was 2ch of slack
               the narrow tiles could not spare. */
            minWidth: "8ch",
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
