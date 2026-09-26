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

/** Upkeep sources in reading order: the structural costs, then the payrolls, then training. */
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
 * What the career's money is doing (decay, subsidy, upkeep), not how much of it
 * there is. Stock has none of those mechanisms, so it renders as one sentence
 * rather than a ledger of zeros that reads as breaking even.
 */
function CareerEconomyComponent({ w, h }: ComponentProps<CareerEconomyConfig>) {
  const careerReading = useTelemetry("career.status");
  // The payload is read on stale too, for structure only: which rows exist.
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

  // The modified set sums to the total; the unmodified one stands in, under its own heading, when the model could not price its sources.
  const breakdown = economy?.upkeep ?? economy?.upkeepBeforeModifiers;
  const beforeModifiers = economy?.upkeep === undefined;
  const breakdownReading = beforeModifiers
    ? economyReading.upkeepBeforeModifiers
    : economyReading.upkeep;

  // The magnitude decides whether a row exists: a source the model does not break out is not a source costing nothing.
  const sources = UPKEEP_SOURCES.flatMap((source) => {
    const amount = magnitudeOf(breakdown?.[source.key]);
    if (amount === null) return [];
    return [{ label: source.label, reading: breakdownReading[source.key] }];
  });

  // Every rate zero or absent with no breakdown means no mechanism, not a mechanism that nets out.
  const inert =
    (decay ?? 0) === 0 &&
    (subsidy ?? 0) === 0 &&
    (upkeep ?? 0) === 0 &&
    sources.length === 0;

  // Only from two rates that both arrived: an absent subsidy is not a zero subsidy.
  const net = netFundsPerDay(economy);
  // Unsigned, since the label carries the direction; taken off the combined reading so it keeps its currency.
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
              {/* The net comes first, so a small tile never hides it. */}
              {net !== null && (
                <div style={RATE_TOTAL_STYLE}>
                  {/* Named, not signed: a leading minus reads as a formatting artefact. */}
                  <span style={RATE_LABEL_STYLE}>
                    {net < 0 ? "Net drain" : "Net gain"}
                  </span>
                  <span style={RATE_VALUE_STYLE}>
                    <Unit value={netSize} />
                  </span>
                </div>
              )}
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

// Without flexWrap the full-width range span squeezes the label under the value instead of taking a second line.
const RATE_STYLE = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "baseline",
  gap: "0.5rem",
  fontVariantNumeric: "tabular-nums",
} as const;

/** The net line, ruled off from the rates below it that it sums. */
const RATE_TOTAL_STYLE = {
  ...RATE_STYLE,
  borderBottom: "1px solid currentColor",
  paddingBottom: "0.25rem",
  marginBottom: "0.15rem",
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
