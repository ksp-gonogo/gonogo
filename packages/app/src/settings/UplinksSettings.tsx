import {
  getSettingsTabsForScreen,
  NO_TELEMETRY_HOST_MESSAGE,
  type Screen,
  type SettingsTabDefinition,
  useTelemetry,
  useTelemetryHostDown,
} from "@ksp-gonogo/core";
import type {
  SystemUplinkHealth,
  UplinkHealthEntry,
} from "@ksp-gonogo/sitrep-client";
import { useStream } from "@ksp-gonogo/sitrep-client";
import { type TabDescriptor, Tabs } from "@ksp-gonogo/ui";
import { SectionTitle, Stack } from "@ksp-gonogo/ui-kit";
import { useState, useSyncExternalStore } from "react";
import {
  getUplinkOutcomes,
  subscribeUplinkOutcomes,
  type UplinkLoadOutcome,
} from "../uplinks/loaderState";
import { CORE_OWNER, GonogoSettings } from "./GonogoSettings";
import { ModSettingsSection } from "./ModSettingsSection";
import { getSettingsForScreen, type SettingDefinition } from "./registry";
import { CategoryRows } from "./SettingRows";
import { Empty, SectionStack } from "./settingsLayout";
import {
  StatusList,
  statusNeedsAttention,
  UplinkClientStatus,
  UplinkHealthReport,
} from "./UplinkStatus";

/** Everything one Uplink has to show on its page, from every place an Uplink's settings come from. */
export interface UplinkPage {
  id: string;
  /** The name the Uplink gives itself, else its id. */
  name: string;
  /** It has rows in Gonogo's own settings file, or its declaration of them failed. */
  gonogo: boolean;
  /** Its declaration of Gonogo settings failed this session. */
  undeclared: boolean;
  /** It reports its host mod's own settings on `settings.<id>`. */
  modSettings: boolean;
  /** Its mod half's own health report, while the mod lists it. */
  health?: UplinkHealthEntry;
  /** Whether the mod's roster has arrived, which tells an Uplink it does not list from one not heard yet. */
  rosterKnown: boolean;
  /** What the runtime loader made of its client, when it tried. */
  client?: UplinkLoadOutcome;
  /** Its health or its client asks for the operator's attention. */
  attention: boolean;
  /** Rows its client registered for this screen. */
  rows: SettingDefinition[];
  /** Custom panels its client registered for this screen. */
  panels: SettingsTabDefinition[];
}

/**
 * Every Uplink the mod lists or the runtime loader tried, and any whose client
 * registered settings for `screen`: the mod's order first, then the rest.
 */
export function useUplinkPages(screen: Screen): UplinkPage[] {
  const health = useStream<SystemUplinkHealth>("system.uplinkHealth");
  const gonogo = useTelemetry("settings.gonogo");
  const rosterKnown = health.state === "observed" || health.state === "stale";
  const roster = rosterKnown ? health.value.uplinks : [];
  const outcomes = useSyncExternalStore(
    subscribeUplinkOutcomes,
    getUplinkOutcomes,
  );
  const model =
    gonogo.state === "observed" || gonogo.state === "stale"
      ? gonogo.value
      : undefined;
  const rows = getSettingsForScreen(screen).filter(
    (def) => def.uplink !== undefined,
  );
  const panels = getSettingsTabsForScreen(screen).filter(
    (tab) => tab.uplink !== undefined,
  );

  const ids: string[] = roster.map((entry) => entry.id);
  const add = (id: string | undefined) => {
    if (id !== undefined && id !== CORE_OWNER && !ids.includes(id))
      ids.push(id);
  };
  for (const row of model?.rows ?? []) add(row.owner);
  for (const failure of model?.undeclared ?? []) add(failure.uplinkId);
  for (const def of rows) add(def.uplink);
  for (const tab of panels) add(tab.uplink);
  for (const outcome of outcomes) add(outcome.id);

  const pages: UplinkPage[] = [];
  for (const id of ids) {
    const entry = roster.find((e) => e.id === id);
    const client = outcomes.find((o) => o.id === id);
    const undeclared =
      model?.undeclared.some((f) => f.uplinkId === id) ?? false;
    pages.push({
      id,
      name: entry?.name ?? client?.name ?? id,
      gonogo: undeclared || (model?.rows.some((r) => r.owner === id) ?? false),
      undeclared,
      modSettings: entry?.modSettings ?? false,
      health: entry,
      rosterKnown,
      client,
      attention: undeclared || statusNeedsAttention(entry, client),
      rows: rows.filter((def) => def.uplink === id),
      panels: panels.filter((tab) => tab.uplink === id),
    });
  }
  return pages;
}

/**
 * The Uplinks tab: one page per Uplink, chosen from a tab strip of its own.
 * Each page leads with how the Uplink is running, then its settings in
 * Gonogo's own file, its host mod's own settings, and what its client keeps
 * on this screen.
 */
export function UplinksSettings({ pages }: { pages: UplinkPage[] }) {
  // Until the operator picks a page, the pick follows the roster as it arrives.
  const [chosen, setChosen] = useState<string | null>(null);
  const activeId =
    chosen ?? pages.find((p) => p.attention)?.id ?? pages[0]?.id ?? "";
  const tabs: TabDescriptor[] = pages.map((page) => ({
    id: page.id,
    label: page.name,
    content: <UplinkPageView page={page} />,
    indicator: page.attention,
  }));
  return (
    <Tabs
      tabs={tabs}
      activeId={activeId}
      onChange={setChosen}
      aria-label="Uplinks"
    />
  );
}

function UplinkPageView({ page }: { page: UplinkPage }) {
  return (
    <SectionStack>
      <Stack as="section" gap="related-comfortable">
        <SectionTitle as="h3" $rule>
          Status
        </SectionTitle>
        <UplinkStatusSection page={page} />
      </Stack>
      {page.gonogo && (
        <Stack as="section" gap="related-comfortable">
          <SectionTitle as="h3" $rule>
            Gonogo
          </SectionTitle>
          <GonogoSettings owner={page.id} />
        </Stack>
      )}
      {page.modSettings && (
        <Stack as="section" gap="related-comfortable">
          <SectionTitle as="h3" $rule>
            {page.name}
          </SectionTitle>
          <ModSettingsSection uplinkId={page.id} name={page.name} />
        </Stack>
      )}
      {page.rows.length > 0 && (
        <Stack as="section" gap="related-comfortable">
          <SectionTitle as="h3" $rule>
            This screen
          </SectionTitle>
          <CategoryRows items={page.rows} />
        </Stack>
      )}
      {page.panels.map((panel) => (
        <Stack as="section" gap="related-comfortable" key={panel.id}>
          <SectionTitle as="h3" $rule>
            {panel.label}
          </SectionTitle>
          <panel.component />
        </Stack>
      ))}
    </SectionStack>
  );
}

/** The mod half's health report, then the client's load outcome. */
function UplinkStatusSection({ page }: { page: UplinkPage }) {
  const hostDown = useTelemetryHostDown();
  return (
    <StatusList>
      {page.health ? (
        <UplinkHealthReport entry={page.health} />
      ) : (
        <li>
          <Empty role="status">{healthAbsence(page, hostDown)}</Empty>
        </li>
      )}
      {page.client && <UplinkClientStatus outcome={page.client} />}
    </StatusList>
  );
}

function healthAbsence(page: UplinkPage, hostDown: boolean): string {
  if (hostDown) return `${NO_TELEMETRY_HOST_MESSAGE}.`;
  if (!page.rosterKnown)
    return `Waiting for KSP to report ${page.name}'s health.`;
  return `KSP does not list ${page.name}.`;
}
