import { formatCompactNumber, getSizeBucket } from "@ksp-gonogo/core";
import type { Value } from "@ksp-gonogo/sitrep-sdk";
import {
  type CommandButtonHandle,
  Panel,
  Section,
  speakQuantity,
  type TabDescriptor,
  Tabs,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { Dispatch, SetStateAction } from "react";
import { FundsDrain, reportsFundsDrain } from "../shared/FundsDrain";
import { magnitudeOf } from "../shared/magnitude";
import { Balance } from "./BalanceRail";
import { partition } from "./partition";
import { ScreenSections } from "./ScreenSections";
import type { ResolvedScreen } from "./screens";
import {
  BalanceRow,
  Empty,
  LockedScreen,
  NotCurrentTally,
  Sep,
  Tally,
  TinyDrainRow,
  TinyFundsFigure,
  TinyFundsRow,
  TinyTally,
} from "./styles";
import type { Strategy } from "./types";

export interface StrategiesViewProps {
  w: number | undefined;
  h: number | undefined;
  strategies: readonly Strategy[] | null;
  screens: readonly ResolvedScreen[];
  commitsUnanswered: boolean;
  funds: Value<"funds"> | null | undefined;
  reputation: Value<"rep"> | null | undefined;
  science: Value<"science"> | null | undefined;
  balancesNotCurrent: boolean;
  /** The standing funds rate beside Activate; stock reports none and it renders nothing. */
  netFunds: number | null;
  factorById: Record<string, number>;
  setFactorById: Dispatch<SetStateAction<Record<string, number>>>;
  activateCmd: CommandButtonHandle;
  deactivateCmd: CommandButtonHandle;
  expandedId: string | null;
  setExpandedId: Dispatch<SetStateAction<string | null>>;
}

/** The highest active-strategy cap the blocked-reason text names, or null when nothing is soft-blocked. */
function inferCap(softBlocked: readonly Strategy[]): number | null {
  for (const s of softBlocked) {
    const m = s.activateBlockedReason.match(/(\d+)\s+active strategies/i);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function tinyFundsTitle(
  balancesNotCurrent: boolean,
  funds: Value<"funds"> | null | undefined,
): string {
  if (balancesNotCurrent) {
    return "The funds balance is no longer current, so affordability is not being checked";
  }
  if (funds != null) return speakQuantity(funds, { decimals: 0 });
  return "No funds balance has arrived";
}

export function StrategiesView({
  w,
  h,
  strategies,
  screens,
  commitsUnanswered,
  funds,
  reputation,
  science,
  balancesNotCurrent,
  netFunds,
  factorById,
  setFactorById,
  activateCmd,
  deactivateCmd,
  expandedId,
  setExpandedId,
}: Readonly<StrategiesViewProps>) {
  const bucket = getSizeBucket(w, h);
  const showSubtitle = (h ?? 8) >= 4;

  if (strategies === null) {
    return (
      <Panel
        panelTitle="Strategies"
        compactTitle={["ADMIN", "ADM"]}
        sections={
          showSubtitle ? (
            <Section full>
              <Empty>Awaiting career data...</Empty>
            </Section>
          ) : null
        }
      />
    );
  }

  /*
   * KSP silently lets a save carry more active strategies than the building's
   * level allows. The cap is inferred from the blocked-reason text across the
   * whole list, because it belongs to the building rather than to a screen.
   */
  const { active, softBlocked } = partition(strategies);
  const inferredCap = inferCap(softBlocked);
  const overCap = inferredCap !== null && active.length > inferredCap;

  const sectionProps = {
    commitsUnanswered,
    funds,
    reputation,
    science,
    balancesNotCurrent,
    factorById,
    setFactorById,
    activateCmd,
    deactivateCmd,
    expandedId,
    setExpandedId,
  };

  if (bucket === "tiny") {
    return (
      <Panel
        panelTitle="Strategies"
        compactTitle={["ADMIN", "ADM"]}
        sections={
          <Section full>
            {/* Funds first, so an ellipsis cuts the active count, never the balance. */}
            <TinyFundsRow
              data-balance-row=""
              title={tinyFundsTitle(balancesNotCurrent, funds)}
            >
              <TinyFundsFigure>
                {balancesNotCurrent ? (
                  "funds not current"
                ) : funds != null ? (
                  <>
                    {formatCompactNumber(funds.magnitude, 0)}
                    <Unit>funds</Unit>
                  </>
                ) : (
                  // Activate refuses on an absent balance, so the row says so rather than vanish.
                  "funds unknown"
                )}
              </TinyFundsFigure>
              <TinyTally>
                <Sep>·</Sep>{" "}
                <Tally $overCap={overCap}>
                  {active.length} active
                  {overCap && ` / ${inferredCap}`}
                </Tally>
              </TinyTally>
            </TinyFundsRow>
            {/* Its own row: the balance row above ellipsises whatever is appended to it. */}
            {reportsFundsDrain(netFunds) && (
              <TinyDrainRow>
                <FundsDrain
                  funds={magnitudeOf(funds)}
                  netPerDay={netFunds}
                  compact
                />
              </TinyDrainRow>
            )}
          </Section>
        }
      />
    );
  }

  return (
    <Panel
      panelTitle="Admin Building"
      compactTitle={["ADMIN", "ADM"]}
      panelAside={
        <Tally $overCap={overCap}>
          {active.length} active
          {overCap && ` / ${inferredCap}`}
        </Tally>
      }
      // One section: a tab strip beside anything reads as two widgets.
      sections={
        <Section full>
          {/* The balances live in the body, because the panel aside collapses at the default size. */}
          <BalanceRow data-balance-row="">
            {balancesNotCurrent ? (
              // One statement, since dashes are what an absent economy already renders.
              <NotCurrentTally title="The career balances are no longer current, so affordability is not being checked">
                balances not current
              </NotCurrentTally>
            ) : (
              <>
                <Tally>
                  <Balance balance={funds} unit="funds" />
                </Tally>
                {reportsFundsDrain(netFunds) && (
                  <>
                    <Sep>·</Sep>
                    <FundsDrain
                      funds={magnitudeOf(funds)}
                      netPerDay={netFunds}
                    />
                  </>
                )}
                {(w ?? 9) >= 6 && (
                  <>
                    <Sep>·</Sep>
                    <Tally>
                      <Balance balance={reputation} unit="rep" />
                    </Tally>
                    <Sep>·</Sep>
                    <Tally>
                      <Balance balance={science} unit="science" />
                    </Tally>
                  </>
                )}
              </>
            )}
          </BalanceRow>
          {screens.length === 0 ? (
            <ScreenSections {...sectionProps} strategies={strategies} />
          ) : (
            <Tabs
              tabs={screens.map(
                (screen): TabDescriptor => ({
                  id: screen.id,
                  label: screen.label,
                  content:
                    screen.lockedReason !== null ? (
                      <LockedScreen>{screen.lockedReason}</LockedScreen>
                    ) : (
                      <ScreenSections
                        {...sectionProps}
                        strategies={screen.strategies}
                        screenId={screen.id}
                        showDepartment={!screen.namesOneDepartment}
                      />
                    ),
                }),
              )}
              aria-label="Administration Building screens"
            />
          )}
        </Section>
      }
    />
  );
}
