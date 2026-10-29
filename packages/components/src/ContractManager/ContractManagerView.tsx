import type { ComponentProps } from "@ksp-gonogo/core";
import { useTelemetry } from "@ksp-gonogo/core";
import { META_VANTAGE, useCommand, useViewUt } from "@ksp-gonogo/sitrep-client";
import { stillTrue } from "@ksp-gonogo/sitrep-sdk";
import {
  ButtonGroup,
  Card,
  Cluster,
  CommandButton,
  EmptyState,
  FilterChip,
  getWidgetShape,
  Panel,
  Section,
  useRowFilter,
} from "@ksp-gonogo/ui-kit";
import { type ReactNode, useState } from "react";
import { heldGrade } from "../shared/heldGrade";
import { noCareerLabel } from "../shared/noCareerLabel";
import { ContractBriefing, ContractDifficulty } from "./ContractBriefing";
import {
  ContractCancelCost,
  ContractDeadline,
  ContractFailureCost,
  ContractRewards,
} from "./ContractCardParts";
import { ContractTerms } from "./ContractTerms";
import type { ContractManagerConfig } from "./config";
import { parseContracts } from "./contracts";
import {
  ACTIVE_ACTIONS_STYLE,
  AGENCY_ROW_STYLE,
  AGENCY_STYLE,
  cardListStyle,
  OFFERED_ACTIONS_STYLE,
  SECTION_LABEL_STYLE,
  SUMMARY_STYLE,
} from "./styles";

type StateFilter = "all" | "active" | "offered" | "completed" | "failed";

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
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const filter = useRowFilter({
    label: "Title",
    placeholder: "Filter...",
  });
  // A save mode with no contracts sends none, so the mode is the only word that nothing is coming.
  const noCareer = noCareerLabel(
    stillTrue(useTelemetry("career.mode"), undefined)?.mode,
    "funds or contracts",
  );
  const contracts = stillTrue(careerReading, undefined)?.contracts;
  // A held board marks every card. Its controls stay live: each command checks the contract it names is still in the state it needs.
  const boardHeld = heldGrade(careerReading);
  const activeRaw = contracts?.active;
  const offeredRaw = contracts?.offered;
  const recentRaw = contracts?.completedRecent;
  const failedRaw = contracts?.failedRecent;
  const universalTime = useViewUt()?.magnitude;
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
  const failed = parseContracts(failedRaw);

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
              <EmptyState>
                {noCareer ?? "Awaiting contract telemetry"}
              </EmptyState>
            )}
          </Section>
        }
      />
    );
  }

  const activeCount = active.length;
  const offeredCount = offered?.length ?? 0;
  const recentCount = recent?.length ?? 0;
  const failedCount = failed?.length ?? 0;

  const matching = (list: typeof active | null) =>
    (list ?? []).filter((c) => filter.matches(c.title));
  const inState = (state: Exclude<StateFilter, "all">) =>
    stateFilter === "all" || stateFilter === state;
  const shownActive = inState("active") ? matching(active) : [];
  const shownOffered = inState("offered") ? matching(offered) : [];
  const shownRecent = inState("completed") ? matching(recent) : [];
  const shownFailed = inState("failed") ? matching(failed) : [];
  const shownCount =
    shownActive.length +
    shownOffered.length +
    shownRecent.length +
    shownFailed.length;
  // A label names each group only while more than one state is listed.
  const labelled = stateFilter === "all";

  const stateChip = (state: StateFilter, label: string, count?: number) => (
    <FilterChip
      label={label}
      count={count}
      selected={stateFilter === state}
      onToggle={() => setStateFilter(state)}
    />
  );

  const activeCards = shownActive.map((c) => (
    <Card
      key={c.id}
      title={c.title}
      titleRight={
        <ContractDeadline
          contract={c}
          offered={false}
          universalTime={universalTime}
          boardHeld={boardHeld}
        />
      }
    >
      <div style={AGENCY_ROW_STYLE}>
        {c.agency && <div style={AGENCY_STYLE}>{c.agency}</div>}
      </div>
      <ContractDifficulty contract={c} />
      <ContractBriefing contract={c} />
      <ContractRewards contract={c} boardHeld={boardHeld} />
      <ContractTerms contract={c} />
      <div style={ACTIVE_ACTIONS_STYLE}>
        <ContractCancelCost contract={c} boardHeld={boardHeld} />
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
    </Card>
  ));
  const offeredCards = shownOffered.map((c) => (
    <Card
      key={c.id}
      title={c.title}
      titleRight={
        <ContractDeadline
          contract={c}
          offered
          universalTime={universalTime}
          boardHeld={boardHeld}
        />
      }
    >
      <div style={AGENCY_ROW_STYLE}>
        {c.agency && <div style={AGENCY_STYLE}>{c.agency}</div>}
      </div>
      <ContractDifficulty contract={c} />
      <ContractBriefing contract={c} />
      <ContractRewards contract={c} boardHeld={boardHeld} />
      <ContractTerms contract={c} />
      <ButtonGroup style={OFFERED_ACTIONS_STYLE}>
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
      </ButtonGroup>
    </Card>
  ));
  const completedCards = shownRecent.map((c) => (
    <Card key={c.id} title={c.title}>
      {c.agency && <div style={AGENCY_STYLE}>{c.agency}</div>}
      <ContractRewards contract={c} boardHeld={boardHeld} />
    </Card>
  ));
  const failedCards = shownFailed.map((c) => (
    <Card key={c.id} title={c.title}>
      {c.agency && <div style={AGENCY_STYLE}>{c.agency}</div>}
      <ContractFailureCost contract={c} />
    </Card>
  ));

  const group = (label: string, cards: ReactNode[]) =>
    cards.length > 0 && (
      <>
        {labelled && <div style={SECTION_LABEL_STYLE}>{label}</div>}
        <div style={cardListStyle(multiColumn)}>{cards}</div>
      </>
    );

  return (
    <Panel
      panelTitle="CONTRACT MANAGER"
      compactTitle={["CONTRACTS"]}
      panelFilter={filter}
      panelToolbar={
        <Cluster
          role="group"
          aria-label="Filter contracts by state"
          justify="start"
          gap="related"
          wrap
        >
          {stateChip("all", "All")}
          {stateChip("active", "Active", activeCount)}
          {stateChip("offered", "Offered", offeredCount)}
          {stateChip("completed", "Completed", recentCount)}
          {stateChip("failed", "Failed", failedCount)}
        </Cluster>
      }
      sections={
        <Section>
          {showSubtitle && (
            <div style={SUMMARY_STYLE} role="status" aria-live="polite">
              {activeCount} active · {offeredCount} offered · {recentCount}{" "}
              recent
              {failedCount > 0 && ` · ${failedCount} failed`}
            </div>
          )}
          {shownCount === 0 && (
            <EmptyState>
              {filter.active || stateFilter !== "all"
                ? "No contracts match the filter"
                : "No active contracts"}
            </EmptyState>
          )}
          {group("Active", activeCards)}
          {group("Offered", offeredCards)}
          {group("Completed", completedCards)}
          {group("Failed", failedCards)}
        </Section>
      }
    />
  );
}
