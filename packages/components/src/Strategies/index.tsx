import type { ComponentProps } from "@ksp-gonogo/core";
import { defineTopicManifest, registerComponent } from "@ksp-gonogo/core";
import { META_VANTAGE, useCommand } from "@ksp-gonogo/sitrep-client";
import { stillTrue } from "@ksp-gonogo/sitrep-sdk";
import { useContributions, usePanelDelay } from "@ksp-gonogo/ui-kit";
import { useMemo, useState } from "react";
import { netFundsPerDay } from "../shared/FundsDrain";
import { parseEffectLines, parseStrategies } from "./parsing";
import { StrategiesView } from "./StrategiesView";
import { resolveScreens } from "./screens";

export type { Strategy } from "./types";
export { parseEffectLines, parseStrategies };

const topics = defineTopicManifest({
  channels: ["career.status"],
  fields: [
    "career.status.strategies.all",
    "career.status.strategies.activationPatched",
    "career.status.economy.funds",
    "career.status.economy.reputation",
    "career.status.economy.science",
    "career.status.economy.subsidyPerDay",
    "career.status.economy.upkeepPerDay",
  ],
});

type StrategiesConfig = Record<string, never>;

function StrategiesComponent({
  w,
  h,
}: Readonly<ComponentProps<StrategiesConfig>>) {
  /*
   * The strategy list is a fact that only moves when the operator acts, so the
   * last list received is still the list. The balances are judgements: they
   * arm or refuse a control that spends them, so a stale balance is withheld.
   */
  const careerReading = topics.useTelemetry("career.status");
  const rosterRaw = stillTrue(careerReading, undefined)?.strategies;
  const stratsRaw = rosterRaw?.all;
  // Only an explicit false says the game's activation is its own; absent and null say nothing.
  const commitsUnanswered = rosterRaw?.activationPatched === false;
  // An affordability verdict may only rest on an observation.
  const economy =
    careerReading.state === "observed"
      ? careerReading.value.economy
      : undefined;
  const funds = economy?.funds;
  const reputation = economy?.reputation;
  const science = economy?.science;
  // Stale balances and a never-arrived economy both refuse Activate, but only one is about the link.
  const balancesNotCurrent = careerReading.state === "stale";
  // The standing funds rate beside Activate; stock reports none and it renders nothing.
  const netFunds = netFundsPerDay(economy);
  // An Administration Building action carries no vessel signal delay.
  const activateCmd = useCommand("career.strategy.activate", {
    vantage: META_VANTAGE,
  });
  const deactivateCmd = useCommand("career.strategy.deactivate", {
    vantage: META_VANTAGE,
  });
  usePanelDelay(activateCmd);
  usePanelDelay(deactivateCmd);

  const strategies = useMemo(() => parseStrategies(stratsRaw), [stratsRaw]);

  // With no screens contributed (stock), the widget draws ungrouped.
  const screenEntries = useContributions("strategies.screens");
  const screens = useMemo(
    () => resolveScreens(screenEntries, strategies ?? []),
    [screenEntries, strategies],
  );

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [factorById, setFactorById] = useState<Record<string, number>>({});

  return (
    <StrategiesView
      w={w}
      h={h}
      strategies={strategies}
      screens={screens}
      commitsUnanswered={commitsUnanswered}
      funds={funds}
      reputation={reputation}
      science={science}
      balancesNotCurrent={balancesNotCurrent}
      netFunds={netFunds}
      factorById={factorById}
      setFactorById={setFactorById}
      activateCmd={activateCmd}
      deactivateCmd={deactivateCmd}
      expandedId={expandedId}
      setExpandedId={setExpandedId}
    />
  );
}

registerComponent<StrategiesConfig>({
  id: "strategies",
  name: "Admin Building",
  description:
    "Administration Building strategies for career mode. Shows active commitments, their per-strategy effect bullets, and the available alternatives with cost previews scaled by the commitment-factor slider. With that building open KSP answers eligibility itself; with it shut the same rules are asked one at a time, which is enough to name what the career refuses but never enough to say yes. A strategy left unanswered can still be committed from here when no other mod has changed how activation works: the remaining checks are made when you confirm.",
  tags: ["career"],
  defaultSize: { w: 5, h: 9 },
  minSize: { w: 2, h: 2 },
  component: StrategiesComponent,
  channels: topics.channels,
  fields: topics.fields,
  defaultConfig: {},
  actions: [],
  pushable: true,
  requires: ["career"],
  contributionSlots: ["strategies.screens"],
  augmentSlots: ["strategies.screen-body"],
});

export { StrategiesComponent };
