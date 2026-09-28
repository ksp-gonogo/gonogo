import {
  getSettingsTabsForScreen,
  type Screen,
  type SettingsTabDefinition,
  useTelemetry,
} from "@ksp-gonogo/core";
import type { SystemUplinkHealth } from "@ksp-gonogo/sitrep-client";
import { useStream } from "@ksp-gonogo/sitrep-client";
import { type TabDescriptor, Tabs } from "@ksp-gonogo/ui";
import { SectionTitle, Stack } from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import { CORE_OWNER, GonogoSettings } from "./GonogoSettings";
import { ModSettingsSection } from "./ModSettingsSection";
import { getSettingsForScreen, type SettingDefinition } from "./registry";
import { CategoryRows } from "./SettingRows";
import { SectionStack } from "./settingsLayout";

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
  /** Rows its client registered for this screen. */
  rows: SettingDefinition[];
  /** Custom panels its client registered for this screen. */
  panels: SettingsTabDefinition[];
}

/**
 * Every Uplink with something to show on `screen`, in the order the mod lists
 * its Uplinks, then any whose client registered settings the mod does not
 * list.
 */
export function useUplinkPages(screen: Screen): UplinkPage[] {
  const health = useStream<SystemUplinkHealth>("system.uplinkHealth");
  const gonogo = useTelemetry("settings.gonogo");
  const roster =
    health.state === "observed" || health.state === "stale"
      ? health.value.uplinks
      : [];
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

  const pages: UplinkPage[] = [];
  for (const id of ids) {
    const entry = roster.find((e) => e.id === id);
    const undeclared =
      model?.undeclared.some((f) => f.uplinkId === id) ?? false;
    const page: UplinkPage = {
      id,
      name: entry?.name ?? id,
      gonogo: undeclared || (model?.rows.some((r) => r.owner === id) ?? false),
      undeclared,
      modSettings: entry?.modSettings ?? false,
      rows: rows.filter((def) => def.uplink === id),
      panels: panels.filter((tab) => tab.uplink === id),
    };
    if (
      page.gonogo ||
      page.modSettings ||
      page.rows.length > 0 ||
      page.panels.length > 0
    ) {
      pages.push(page);
    }
  }
  return pages;
}

/**
 * The Uplinks tab: one page per Uplink, chosen from a tab strip of its own.
 * Each page leads with the Uplink's settings in Gonogo's own file, then its
 * host mod's own settings, then what its client keeps on this screen.
 */
export function UplinksSettings({ pages }: { pages: UplinkPage[] }) {
  // Until the operator picks a page, the pick follows the roster as it arrives.
  const [chosen, setChosen] = useState<string | null>(null);
  const activeId =
    chosen ?? pages.find((p) => p.undeclared)?.id ?? pages[0]?.id ?? "";
  const tabs: TabDescriptor[] = pages.map((page) => ({
    id: page.id,
    label: page.name,
    content: <UplinkPageView page={page} />,
    indicator: page.undeclared,
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
