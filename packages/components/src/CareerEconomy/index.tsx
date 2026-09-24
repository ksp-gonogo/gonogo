import type { ComponentProps } from "@ksp-gonogo/core";
import {
  defineTopicManifest,
  getSizeBucket,
  registerComponent,
  useTelemetry,
} from "@ksp-gonogo/core";
import { combineReadings } from "@ksp-gonogo/sitrep-sdk";
import { Panel, Section, Unit } from "@ksp-gonogo/ui-kit";
import { netFundsPerDay, netFundsPerDayReading } from "../shared/FundsDrain";
import { magnitudeOf } from "../shared/magnitude";

const topics = defineTopicManifest({
  channels: ["career.status"],
  fields: [
    "career.status.economy.funds",
    "career.status.economy.reputation",
    "career.status.economy.economyModel",
    "career.status.economy.reputationDecayPerDay",
    "career.status.economy.subsidyPerDay",
    "career.status.economy.subsidyMinPerDay",
    "career.status.economy.subsidyMaxPerDay",
    "career.status.economy.upkeepPerDay",
    "career.status.economy.upkeep",
    "career.status.economy.upkeepBeforeModifiers",
  ],
});

type CareerEconomyConfig = Record<string, never>;

/**
 * Every upkeep source the wire can carry, in the order they are read out.
 *
 * The order is the operator's, not the wire's: the two structural costs, then
 * the three payrolls, then training.
 */
const UPKEEP_SOURCES = [
  { key: "facilities", label: "Facilities" },
  { key: "launchComplexes", label: "Launch complexes" },
  { key: "integrationSalary", label: "Integration" },
  { key: "researchSalary", label: "Research" },
  { key: "crewBase", label: "Crew" },
  { key: "crewInFlight", label: "Crew in flight" },
  { key: "training", label: "Training" },
] as const;

/**
 * What this career's money is DOING, as opposed to how much of it there is.
 *
 * Reputation, funds and science are three balances core has always published,
 * and under a career overhaul the first two stop being scores: reputation
 * decays daily and buys a funding subsidy, against which a continuous per-day
 * cost runs. Those qualifiers arrive from whichever money model won the
 * `economy` capability, so this widget renders the same shape whether that was
 * an overhaul or stock.
 *
 * Stock's answer is that money does none of those things, which is true rather
 * than empty, and it renders as one sentence instead of a ledger of zeros. A
 * ledger reads as a programme that happens to break even; the sentence says
 * there is no mechanism.
 */
function CareerEconomyComponent({ w, h }: ComponentProps<CareerEconomyConfig>) {
  const careerReading = useTelemetry("career.status");
  /*
   * Every number below is a rate or a balance that moves on its own, so how
   * current each one is belongs ON the figure: the field readings below carry
   * that, and `Unit` marks a value the link stopped carrying rather than
   * drawing it as though it had just arrived. `career.status` declares no
   * reckonable value, so there is no model to fall back to and the mark is the
   * whole of the answer.
   *
   * The PAYLOAD is read on `stale` as well, for the structure only: which rows
   * exist, which sources the model broke out. Withholding it there left the
   * widget saying "no career economy has arrived" under a caption explaining
   * that the last one had, which is two answers to one question.
   */
  const economyReading = careerReading.economy;
  const economy =
    careerReading.state === "observed" || careerReading.state === "stale"
      ? careerReading.value.economy
      : undefined;

  const model = economy?.economyModel;
  const decay = magnitudeOf(economy?.reputationDecayPerDay);
  const subsidy = magnitudeOf(economy?.subsidyPerDay);
  const subsidyMin = magnitudeOf(economy?.subsidyMinPerDay);
  const subsidyMax = magnitudeOf(economy?.subsidyMaxPerDay);
  const upkeep = magnitudeOf(economy?.upkeepPerDay);

  /* The modified set is the one that decomposes the total beside it, so it is
     the one to show. The unmodified set stands in when the model could not
     price its own sources, and says so in its heading rather than quietly
     rendering a list that does not add up: that mismatch is exactly what this
     pair of fields exists to stop. */
  const breakdown = economy?.upkeep ?? economy?.upkeepBeforeModifiers;
  const beforeModifiers = economy?.upkeep === undefined;
  const breakdownReading = beforeModifiers
    ? economyReading.upkeepBeforeModifiers
    : economyReading.upkeep;

  /* The magnitude decides whether the row EXISTS (a source the model does not
     break out is not a source costing nothing), and the reading is what the row
     draws. Addressable because the seven keys are this file's own table and not
     a selection off the wire, so each has a path the accessor can walk. */
  const sources = UPKEEP_SOURCES.flatMap((source) => {
    const amount = magnitudeOf(breakdown?.[source.key]);
    if (amount === null) return [];
    return [{ label: source.label, reading: breakdownReading[source.key] }];
  });

  // A model that reports every rate as zero and offers no breakdown is saying
  // it has no mechanism, not that its mechanism nets out. Absent rates read the
  // same way here: nothing to show either way.
  const inert =
    (decay ?? 0) === 0 &&
    (subsidy ?? 0) === 0 &&
    (upkeep ?? 0) === 0 &&
    sources.length === 0;

  // Only from two rates that both arrived. Treating an absent subsidy as zero
  // would report a drain the model never claimed. Shared with the readout every
  // funds-spending widget carries, so the two cannot disagree about what this
  // career is costing.
  const net = netFundsPerDay(economy);
  /* The figure the row draws, unsigned: the label carries the direction, so the
     magnitude is taken off the combination rather than off its inputs, which is
     what keeps the currency on a net worked out from a subsidy that is no
     longer current. */
  const netSize = combineReadings(
    [
      netFundsPerDayReading(
        economyReading.subsidyPerDay,
        economyReading.upkeepPerDay,
      ),
    ],
    (rate) => rate.abs(),
  );

  const bucket = getSizeBucket(w, h);
  const compact = bucket === "tiny" || (w ?? 6) < 4;

  return (
    <Panel
      panelTitle="PROGRAMME FUNDING"
      compactTitle={["FUNDING", "FUNDS", "FUND"]}
      sections={[
        /* Balances span: the rates and the breakdown below are both about what
           happens to them. */
        <Section key="balances" full>
          <div style={BALANCES_STYLE}>
            <div style={BALANCE_STYLE}>
              <span style={BALANCE_LABEL_STYLE}>Funds</span>
              <span style={BALANCE_VALUE_STYLE}>
                <Unit value={economyReading.funds} />
              </span>
            </div>
            <div style={BALANCE_STYLE}>
              <span style={BALANCE_LABEL_STYLE}>Reputation</span>
              <span style={BALANCE_VALUE_STYLE}>
                <Unit value={economyReading.reputation} />
              </span>
            </div>
          </div>
        </Section>,
        <Section key="rates">
          {economy === undefined ? (
            <p style={CAPTION_STYLE}>No career economy has arrived.</p>
          ) : inert ? (
            <p style={CAPTION_STYLE}>
              This career's money does not decay, earns no subsidy and costs
              nothing to hold.
            </p>
          ) : (
            <div style={RATES_STYLE}>
              {decay !== null && decay !== 0 && (
                <div style={RATE_STYLE}>
                  <span style={RATE_LABEL_STYLE}>Reputation decay</span>
                  <span style={RATE_VALUE_STYLE}>
                    <Unit value={economyReading.reputationDecayPerDay} />
                  </span>
                </div>
              )}
              {subsidy !== null && (
                <div style={RATE_STYLE}>
                  <span style={RATE_LABEL_STYLE}>Subsidy</span>
                  <span style={RATE_VALUE_STYLE}>
                    <Unit value={economyReading.subsidyPerDay} />
                  </span>
                  {subsidyMin !== null && subsidyMax !== null && (
                    <span style={RATE_RANGE_STYLE}>
                      of <Unit value={economyReading.subsidyMinPerDay} /> to{" "}
                      <Unit value={economyReading.subsidyMaxPerDay} />
                    </span>
                  )}
                </div>
              )}
              {upkeep !== null && (
                <div style={RATE_STYLE}>
                  <span style={RATE_LABEL_STYLE}>Upkeep</span>
                  <span style={RATE_VALUE_STYLE}>
                    <Unit value={economyReading.upkeepPerDay} />
                  </span>
                </div>
              )}
              {net !== null && (
                <div style={RATE_TOTAL_STYLE}>
                  {/* Named rather than signed: a leading minus on a rate beside
                    two positive ones is read as a formatting artefact about as
                    often as it is read as a direction. */}
                  <span style={RATE_LABEL_STYLE}>
                    {net < 0 ? "Net drain" : "Net gain"}
                  </span>
                  <span style={RATE_VALUE_STYLE}>
                    <Unit value={netSize} />
                  </span>
                </div>
              )}
            </div>
          )}
        </Section>,
        sources.length > 0 && !compact && (
          <Section
            key="breakdown"
            titleAs="h3"
            title={
              beforeModifiers
                ? "Where the upkeep goes, before discounts"
                : "Where the upkeep goes"
            }
          >
            <dl style={BREAKDOWN_LIST_STYLE}>
              {sources.map((source) => (
                <div key={source.label} style={BREAKDOWN_ROW_STYLE}>
                  <dt style={BREAKDOWN_TERM_STYLE}>{source.label}</dt>
                  <dd style={BREAKDOWN_VALUE_STYLE}>
                    <Unit value={source.reading} />
                  </dd>
                </div>
              ))}
            </dl>
          </Section>
        ),
        model !== undefined && model !== null && (
          <Section key="model" full>
            <p style={MODEL_STYLE}>Model: {model}</p>
          </Section>
        ),
      ]}
    />
  );
}

const BALANCES_STYLE = {
  display: "flex",
  gap: "1.2rem",
  flexWrap: "wrap",
} as const;

const BALANCE_STYLE = {
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
} as const;

const BALANCE_LABEL_STYLE = {
  fontSize: "0.7rem",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  opacity: 0.7,
} as const;

const BALANCE_VALUE_STYLE = {
  fontSize: "1.1rem",
  fontVariantNumeric: "tabular-nums",
} as const;

const CAPTION_STYLE = {
  margin: 0,
  fontSize: "0.8rem",
  opacity: 0.8,
} as const;

const RATES_STYLE = {
  display: "flex",
  flexDirection: "column",
  gap: "0.25rem",
} as const;

/*
 * `flexWrap` is load-bearing rather than tidy: the range span asks for a whole
 * line with `flex-basis: 100%`, and on a row that cannot wrap it takes that
 * width from its siblings instead of from a second line. The label then shrinks
 * below its own text and paints under the value, which is what "Subsidy" and
 * "1840.0 f/day" were doing to each other on every career with a subsidy range.
 */
const RATE_STYLE = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "baseline",
  gap: "0.5rem",
  fontVariantNumeric: "tabular-nums",
} as const;

/** The net line, ruled off from the rates it sums. */
const RATE_TOTAL_STYLE = {
  ...RATE_STYLE,
  borderTop: "1px solid currentColor",
  paddingTop: "0.25rem",
  marginTop: "0.15rem",
} as const;

const RATE_LABEL_STYLE = {
  flex: "1 1 auto",
  minWidth: 0,
  fontSize: "0.85rem",
} as const;

const RATE_VALUE_STYLE = { flex: "0 0 auto" } as const;

const RATE_RANGE_STYLE = {
  flexBasis: "100%",
  fontSize: "0.75rem",
  opacity: 0.7,
} as const;

const BREAKDOWN_LIST_STYLE = {
  margin: 0,
  display: "flex",
  flexDirection: "column",
  gap: "0.1rem",
} as const;

const BREAKDOWN_ROW_STYLE = {
  display: "flex",
  gap: "0.5rem",
  fontSize: "0.8rem",
  fontVariantNumeric: "tabular-nums",
} as const;

const BREAKDOWN_TERM_STYLE = {
  flex: "1 1 auto",
  minWidth: 0,
  opacity: 0.8,
} as const;

const BREAKDOWN_VALUE_STYLE = { margin: 0, flex: "0 0 auto" } as const;

const MODEL_STYLE = {
  margin: 0,
  fontSize: "0.7rem",
  opacity: 0.6,
} as const;

registerComponent<CareerEconomyConfig>({
  id: "career-economy",
  name: "Programme Funding",
  description:
    "What a career's money is doing rather than how much of it there is: the funds and reputation balances, the reputation's daily decay, the funding subsidy it currently earns against the range it could, the standing per-day cost and where that cost goes, and the net of the two. Stock career says money does none of this, and says so in a sentence.",
  tags: ["career"],
  defaultSize: { w: 4, h: 7 },
  minSize: { w: 2, h: 3 },
  component: CareerEconomyComponent,
  channels: topics.channels,
  fields: topics.fields,
  defaultConfig: {},
  actions: [],
  pushable: true,
  requires: ["career"],
});

export { CareerEconomyComponent };
