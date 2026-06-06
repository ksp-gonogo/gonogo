import { DataSourceStatusComponent } from "@gonogo/components";
import { useDataSources, useScreen } from "@gonogo/core";
import { SerialDevicesMenu, useSerialAggregateStatus } from "@gonogo/serial";
import { Switch, type TabDescriptor, Tabs } from "@gonogo/ui";
import { useState, useSyncExternalStore } from "react";
import styled from "styled-components";
import { analyticsConsentService } from "../analytics/AnalyticsConsentService";
import { LogsManager } from "../logs/LogsManager";
import type { SettingDefinition } from "./registry";
import { getSettingsForScreen } from "./registry";
import { useSetting } from "./SettingsContext";

/**
 * Tabbed settings surface. Beyond the auto-rendered registered settings
 * (the "General" tab), this is also the home for the connection/device
 * management that used to live in standalone FABs — Data Sources, Devices
 * (serial), and Diagnostics. Each tab can raise an attention dot; the
 * Settings FAB aggregates those dots into its own badge (see SettingsFab).
 */
export function SettingsModal() {
  const screen = useScreen();
  const settings = getSettingsForScreen(screen);
  // The analytics-consent toggle is host-owned, so it only appears on the
  // main screen. Stations follow the host's consent over PeerJS and have
  // no local control.
  const showConsent = screen === "main";
  // Data-source management is main-only — stations follow the host over
  // PeerJS and have nothing to manage locally.
  const showDataSources = screen === "main";

  const dataSources = useDataSources();
  const dataSourceIssue =
    showDataSources &&
    dataSources.some(
      (s) => s.status === "disconnected" || s.status === "error",
    );
  const serialStatus = useSerialAggregateStatus();
  const serialIssue = serialStatus === "partial" || serialStatus === "error";

  const hasGeneral = settings.length > 0 || showConsent;

  const tabs: TabDescriptor[] = [];
  if (hasGeneral) {
    tabs.push({
      id: "general",
      label: "General",
      content: (
        <GeneralSettings settings={settings} showConsent={showConsent} />
      ),
    });
  }
  if (showDataSources) {
    tabs.push({
      id: "data-sources",
      label: "Data Sources",
      // Renders its own "DATA SOURCES" header, so no extra section title.
      content: <DataSourceStatusComponent />,
      indicator: dataSourceIssue,
    });
  }
  tabs.push({
    id: "devices",
    label: "Devices",
    content: <SerialDevicesMenu />,
    indicator: serialIssue,
  });
  tabs.push({
    id: "diagnostics",
    label: "Diagnostics",
    content: <LogsManager />,
  });

  // Open on the first tab that wants attention, else the first tab.
  const [activeId, setActiveId] = useState(
    () => tabs.find((t) => t.indicator)?.id ?? tabs[0]?.id ?? "general",
  );

  if (tabs.length === 0) {
    return <Empty>No settings yet on the {screen} screen.</Empty>;
  }

  return (
    <Wrap>
      <Tabs tabs={tabs} activeId={activeId} onChange={setActiveId} />
    </Wrap>
  );
}

/** The auto-rendered registered settings + the privacy consent toggle. */
function GeneralSettings({
  settings,
  showConsent,
}: {
  settings: SettingDefinition[];
  showConsent: boolean;
}) {
  const byCategory = new Map<string, SettingDefinition[]>();
  for (const s of settings) {
    const bucket = byCategory.get(s.category);
    if (bucket) bucket.push(s);
    else byCategory.set(s.category, [s]);
  }

  return (
    <SectionStack>
      {[...byCategory.entries()].map(([category, items]) => (
        <Section key={category}>
          <SectionTitle>{category}</SectionTitle>
          {items.map((def) => (
            <SettingRow key={def.id} def={def} />
          ))}
        </Section>
      ))}
      {showConsent && (
        <Section>
          <SectionTitle>Privacy</SectionTitle>
          <AnalyticsConsentRow />
        </Section>
      )}
    </SectionStack>
  );
}

/**
 * Re-toggle for the technical-analytics consent the boot modal first
 * asked about. Bound directly to `analyticsConsentService` (its own
 * localStorage slot) rather than the settings registry — the boot modal,
 * the browser Axiom gate, and the peer/relay propagation all read that
 * same service, so routing this through the registry's `gonogo.settings`
 * store would split the source of truth.
 */
function AnalyticsConsentRow() {
  const enabled = useSyncExternalStore(
    (cb) => analyticsConsentService.subscribe(cb),
    () => analyticsConsentService.isEnabled(),
  );
  return (
    <Row>
      <RowText>
        <RowLabel>Send technical analytics</RowLabel>
        <RowDesc>
          Share anonymous technical logs and errors with the developer to help
          debugging. Applies to this main screen and every connected station.
        </RowDesc>
      </RowText>
      <Switch
        checked={enabled}
        onChange={(next) =>
          analyticsConsentService.set(next ? "enabled" : "disabled")
        }
      />
    </Row>
  );
}

function SettingRow({ def }: { def: SettingDefinition }) {
  // Only boolean is defined today. Switch renders inline; its own <label>
  // wrapper supplies the accessible name, and we render the long-form
  // description alongside.
  if (def.type === "boolean") {
    return <BooleanRow def={def} />;
  }
  return null;
}

function BooleanRow({
  def,
}: {
  def: Extract<SettingDefinition, { type: "boolean" }>;
}) {
  const [value, setValue] = useSetting<boolean>(def.id, def.defaultValue);
  return (
    <Row>
      <RowText>
        <RowLabel>{def.label}</RowLabel>
        {def.description && <RowDesc>{def.description}</RowDesc>}
      </RowText>
      <Switch checked={value} onChange={setValue} />
    </Row>
  );
}

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  /* Give the tab system a workable box: wide enough for the embedded
     Data Sources / Devices / Diagnostics panels, and a height so a tall
     panel scrolls within the modal rather than stretching it unbounded. */
  min-width: 460px;
  max-width: 80vw;
  height: min(70vh, 640px);
  min-height: 0;
`;

const SectionStack = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
  min-height: 0;
`;

const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const SectionTitle = styled.h3`
  margin: 0;
  font-size: var(--font-size-sm);
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  border-bottom: 1px solid var(--color-border-subtle);
  padding-bottom: 4px;
`;

const Row = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
`;

const RowText = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
`;

const RowLabel = styled.span`
  color: var(--color-text-primary);
  font-size: var(--font-size-base);
`;

const RowDesc = styled.span`
  color: var(--color-text-dim);
  font-size: var(--font-size-sm);
  max-width: 32em;
`;

const Empty = styled.div`
  color: var(--color-text-faint);
  font-size: var(--font-size-sm);
  padding: 20px;
  text-align: center;
`;
