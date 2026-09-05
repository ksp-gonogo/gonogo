import type { ComponentProps } from "@ksp-gonogo/core";
import {
  defineTopicManifest,
  getSizeBucket,
  registerComponent,
  useTelemetry,
} from "@ksp-gonogo/core";
import type { Reading } from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { NULL_DISPLAY, Panel, Section, Unit } from "@ksp-gonogo/ui-kit";
import styled from "styled-components";
import { netFundsPerDay } from "../shared/FundsDrain";
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
 * The value a VERDICT may be drawn from: current, or modelled forward to the
 * frame. Every number this widget shows is a rate or a balance that moves on
 * its own, so a stale one is not an answer to "what is my programme costing
 * now".
 */
function judgeable<T>(reading: Reading<T>): T | undefined {
  if (reading.reckoning === "available") return reading.reckoned.value;
  if (reading.state === "observed") return reading.value;
  return undefined;
}

/** Whether a reading went stale, as opposed to never having arrived. */
function notCurrent<T>(reading: Reading<T>): boolean {
  return reading.state === "stale";
}

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
  const economy = judgeable(careerReading)?.economy;
  const stale = notCurrent(careerReading);

  const funds = magnitudeOf(economy?.funds);
  const reputation = magnitudeOf(economy?.reputation);
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

  const sources = UPKEEP_SOURCES.flatMap((source) => {
    const amount = magnitudeOf(breakdown?.[source.key]);
    return amount === null ? [] : [{ label: source.label, amount }];
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
          <Balances>
            <Balance>
              <BalanceLabel>Funds</BalanceLabel>
              <BalanceValue>
                {funds !== null ? (
                  <Unit value={value("funds", funds)} />
                ) : (
                  NULL_DISPLAY
                )}
              </BalanceValue>
            </Balance>
            <Balance>
              <BalanceLabel>Reputation</BalanceLabel>
              <BalanceValue>
                {reputation !== null ? (
                  <Unit value={value("rep", reputation)} />
                ) : (
                  NULL_DISPLAY
                )}
              </BalanceValue>
            </Balance>
          </Balances>
        </Section>,
        stale && (
          <Section key="stale" full>
            <Caption>
              No longer current: these are the last rates that arrived.
            </Caption>
          </Section>
        ),
        <Section key="rates">
          {economy === undefined ? (
            <Caption>No career economy has arrived.</Caption>
          ) : inert ? (
            <Caption>
              This career's money does not decay, earns no subsidy and costs
              nothing to hold.
            </Caption>
          ) : (
            <Rates>
              {decay !== null && decay !== 0 && (
                <Rate>
                  <RateLabel>Reputation decay</RateLabel>
                  <RateValue>
                    <Unit value={value("rep/day", decay)} />
                  </RateValue>
                </Rate>
              )}
              {subsidy !== null && (
                <Rate>
                  <RateLabel>Subsidy</RateLabel>
                  <RateValue>
                    <Unit value={value("f/day", subsidy)} />
                  </RateValue>
                  {subsidyMin !== null && subsidyMax !== null && (
                    <RateRange>
                      of <Unit value={value("f/day", subsidyMin)} /> to{" "}
                      <Unit value={value("f/day", subsidyMax)} />
                    </RateRange>
                  )}
                </Rate>
              )}
              {upkeep !== null && (
                <Rate>
                  <RateLabel>Upkeep</RateLabel>
                  <RateValue>
                    <Unit value={value("f/day", upkeep)} />
                  </RateValue>
                </Rate>
              )}
              {net !== null && (
                <Rate $total>
                  {/* Named rather than signed: a leading minus on a rate beside
                    two positive ones is read as a formatting artefact about as
                    often as it is read as a direction. */}
                  <RateLabel>{net < 0 ? "Net drain" : "Net gain"}</RateLabel>
                  <RateValue>
                    <Unit value={value("f/day", Math.abs(net))} />
                  </RateValue>
                </Rate>
              )}
            </Rates>
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
            <BreakdownList>
              {sources.map((source) => (
                <BreakdownRow key={source.label}>
                  <dt>{source.label}</dt>
                  <dd>
                    <Unit value={value("f/day", source.amount)} />
                  </dd>
                </BreakdownRow>
              ))}
            </BreakdownList>
          </Section>
        ),
        model !== undefined && model !== null && (
          <Section key="model" full>
            <Model>Model: {model}</Model>
          </Section>
        ),
      ]}
    />
  );
}

const Balances = styled.div`
  display: flex;
  gap: 1.2rem;
  flex-wrap: wrap;
`;

const Balance = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
`;

const BalanceLabel = styled.span`
  font-size: 0.7rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  opacity: 0.7;
`;

const BalanceValue = styled.span`
  font-size: 1.1rem;
  font-variant-numeric: tabular-nums;
`;

const Caption = styled.p`
  margin: 0;
  font-size: 0.8rem;
  opacity: 0.8;
`;

const Rates = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
`;

/* `flex-wrap` is load-bearing rather than tidy: `RateRange` asks for a whole
   line with `flex-basis: 100%`, and on a row that cannot wrap it takes that
   width from its siblings instead of from a second line. The label then shrinks
   below its own text and paints under the value, which is what "Subsidy" and
   "1840.0 f/day" were doing to each other on every career with a subsidy
   range. */
const Rate = styled.div<{ $total?: boolean }>`
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.5rem;
  font-variant-numeric: tabular-nums;
  ${({ $total }) =>
    $total
      ? "border-top: 1px solid currentColor; padding-top: 0.25rem; margin-top: 0.15rem;"
      : ""}
`;

const RateLabel = styled.span`
  flex: 1 1 auto;
  min-width: 0;
  font-size: 0.85rem;
`;

const RateValue = styled.span`
  flex: 0 0 auto;
`;

const RateRange = styled.span`
  flex-basis: 100%;
  font-size: 0.75rem;
  opacity: 0.7;
`;

const BreakdownList = styled.dl`
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
`;

const BreakdownRow = styled.div`
  display: flex;
  gap: 0.5rem;
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;

  dt {
    flex: 1 1 auto;
    min-width: 0;
    opacity: 0.8;
  }

  dd {
    margin: 0;
    flex: 0 0 auto;
  }
`;

const Model = styled.p`
  margin: 0;
  font-size: 0.7rem;
  opacity: 0.6;
`;

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
