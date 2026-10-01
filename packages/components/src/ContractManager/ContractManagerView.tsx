import type { ComponentProps } from "@ksp-gonogo/core";
import { useTelemetry } from "@ksp-gonogo/core";
import { META_VANTAGE, useCommand, useViewUt } from "@ksp-gonogo/sitrep-client";
import { stillTrue } from "@ksp-gonogo/sitrep-sdk";
import {
  Block,
  CommandButton,
  getWidgetShape,
  Panel,
  Section,
} from "@ksp-gonogo/ui-kit";
import { heldGrade } from "../shared/heldGrade";
import { ContractDeadline, ContractRewards } from "./ContractCardParts";
import { ContractTerms } from "./ContractTerms";
import type { ContractManagerConfig } from "./config";
import { parseContracts } from "./contracts";
import {
  ACTIVE_ACTIONS_STYLE,
  AGENCY_STYLE,
  cardListStyle,
  EMPTY_STYLE,
  OFFERED_ACTIONS_STYLE,
  SECTION_LABEL_STYLE,
  SUMMARY_STYLE,
} from "./styles";

/**
 * A contract as a grouping rather than a box: the panel is already a surface,
 * so the separation is the list gap and the title's weight.
 */
const ContractCard = Block;

export function ContractManagerComponent({
  w,
  h,
}: Readonly<ComponentProps<ContractManagerConfig>>) {
  /*
   * The contract board is a fact: it changes only when the player or the game
   * acts, so the last board sent is still the board. The deadline countdown is
   * computed from a fixed `deadlineUt` against the confirmed view UT, so it holds
   * rather than inventing progress.
   */
  const careerReading = useTelemetry("career.status");
  const contracts = stillTrue(careerReading, undefined)?.contracts;
  // A held board marks every card. Its controls stay live: each command checks the contract it names is still in the state it needs.
  const boardHeld = heldGrade(careerReading);
  const activeRaw = contracts?.active;
  const offeredRaw = contracts?.offered;
  const recentRaw = contracts?.completedRecent;
  const universalTime = useViewUt()?.magnitude ?? 0;
  // Career actions dispatch at the meta-vantage, with no vessel signal delay.
  const acceptCmd = useCommand("career.contract.accept", {
    vantage: META_VANTAGE,
  });
  const declineCmd = useCommand("career.contract.decline", {
    vantage: META_VANTAGE,
  });
  const cancelCmd = useCommand("career.contract.cancel", {
    vantage: META_VANTAGE,
  });
  const active = parseContracts(activeRaw);
  const offered = parseContracts(offeredRaw);
  const recent = parseContracts(recentRaw);

  const rows = h ?? 8;
  const showSubtitle = rows >= 4;
  // Only the shape can see a wide-short box stranding a single-column list, so landscape flows into a grid.
  const { shape } = getWidgetShape(w, h);
  const multiColumn = shape === "landscape";

  if (active === null) {
    return (
      <Panel
        panelTitle="CONTRACT MANAGER"
        compactTitle={["CONTRACTS"]}
        sections={
          <Section>
            {showSubtitle && (
              <div style={EMPTY_STYLE}>Awaiting contract telemetry</div>
            )}
          </Section>
        }
      />
    );
  }

  const activeCount = active.length;
  const offeredCount = offered?.length ?? 0;
  const recentCount = recent?.length ?? 0;

  return (
    <Panel
      panelTitle="CONTRACT MANAGER"
      compactTitle={["CONTRACTS"]}
      sections={
        <Section>
          {showSubtitle && (
            <div style={SUMMARY_STYLE} role="status" aria-live="polite">
              {activeCount} active · {offeredCount} offered · {recentCount}{" "}
              recent
            </div>
          )}
          {activeCount === 0 && offeredCount === 0 && (
            <div style={EMPTY_STYLE}>
              No active contracts. Pick one up in Mission Control.
            </div>
          )}
          {activeCount > 0 && <div style={SECTION_LABEL_STYLE}>Active</div>}
          <div style={cardListStyle(multiColumn)}>
            {active.map((c) => (
              <ContractCard
                key={c.id}
                title={c.title}
                titleRight={
                  <ContractDeadline
                    deadlineUt={c.deadlineUt}
                    universalTime={universalTime}
                    boardHeld={boardHeld}
                  />
                }
              >
                {c.agency && <div style={AGENCY_STYLE}>{c.agency}</div>}
                <ContractRewards contract={c} />
                <ContractTerms contract={c} />
                <div style={ACTIVE_ACTIONS_STYLE}>
                  <CommandButton
                    handle={cancelCmd}
                    args={{ contractId: c.id }}
                    commandLabel={`Cancel ${c.title}`}
                    size="sm"
                    label="Cancel"
                    /* Cancel forfeits work in progress and spent funds, so its confirm is stronger than Decline's. */
                    confirmLabel="Forfeit contract"
                    confirmTone="nogo"
                    pendingLabel="Cancelling..."
                    title="Cancel this contract: forfeits all progress"
                  />
                </div>
              </ContractCard>
            ))}
          </div>
          {offeredCount > 0 && <div style={SECTION_LABEL_STYLE}>Offered</div>}
          <div style={cardListStyle(multiColumn)}>
            {offered?.map((c) => (
              <ContractCard
                key={c.id}
                title={c.title}
                titleRight={
                  <ContractDeadline
                    deadlineUt={c.deadlineUt}
                    universalTime={universalTime}
                    boardHeld={boardHeld}
                  />
                }
              >
                {c.agency && <div style={AGENCY_STYLE}>{c.agency}</div>}
                <ContractRewards contract={c} />
                <div style={OFFERED_ACTIONS_STYLE}>
                  <CommandButton
                    handle={acceptCmd}
                    args={{ contractId: c.id }}
                    commandLabel={`Accept ${c.title}`}
                    size="sm"
                    tone="go"
                    label="Accept"
                    pendingLabel="Accepting..."
                  />
                  <CommandButton
                    handle={declineCmd}
                    args={{ contractId: c.id }}
                    commandLabel={`Decline ${c.title}`}
                    size="sm"
                    label="Decline"
                    confirmLabel="Confirm decline"
                    confirmTone="nogo"
                    pendingLabel="Declining..."
                  />
                </div>
              </ContractCard>
            ))}
          </div>
        </Section>
      }
    />
  );
}
