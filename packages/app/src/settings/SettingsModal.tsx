import {
  getSettingsTabsForScreen,
  useDataSources,
  useScreen,
} from "@ksp-gonogo/core";
import {
  SerialDevicesMenu,
  useSerialAggregateStatus,
} from "@ksp-gonogo/serial";
import type {
  SystemUplinkHealth,
  UplinkHealthEntry,
  UplinkHealthStateName,
} from "@ksp-gonogo/sitrep-client";
import { useStream } from "@ksp-gonogo/sitrep-client";
import {
  GhostButton,
  Placeholder,
  Switch,
  type TabDescriptor,
  Tabs,
} from "@ksp-gonogo/ui";
import { useState, useSyncExternalStore } from "react";
import styled from "styled-components";
import { analyticsConsentService } from "../analytics/AnalyticsConsentService";
import { BackupManager } from "../backup/BackupManager";
import { LogsManager } from "../logs/LogsManager";
import { revokeConsent } from "../uplinks/consent";
import {
  getUplinkOutcomes,
  subscribeUplinkOutcomes,
  type UplinkLoadStatus,
} from "../uplinks/loaderState";
import type { SettingDefinition } from "./registry";
import { getSetting, getSettingsForScreen } from "./registry";
import { useSetting } from "./SettingsContext";
import { ConnectionRow, Name, SitrepConnection } from "./SitrepConnection";

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

  // Data Sources now leads with the single Gonogo/Sitrep connection (no
  // more "Other Connections" list of every registered DataSource — see
  // DataSourcesPanel) plus per-Uplink health rows fed by the mod-side
  // self-report (system.uplinkHealth). The tab's attention dot reflects
  // both: the stream connection itself, and any Uplink reporting worse
  // than Healthy.
  const dataSources = useDataSources();
  const sitrepSource = dataSources.find((s) => s.id === "sitrep");
  const uplinkHealth = useStream<SystemUplinkHealth>("system.uplinkHealth");
  const uplinkIssue =
    uplinkHealth?.uplinks.some((u) => u.health.state !== "healthy") ?? false;
  const dataSourceIssue =
    showDataSources &&
    (sitrepSource?.status === "disconnected" ||
      sitrepSource?.status === "error" ||
      uplinkIssue);
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
      content: <DataSourcesPanel />,
      indicator: dataSourceIssue,
    });
  }
  tabs.push({
    id: "devices",
    label: "Devices",
    content: <SerialDevicesMenu />,
    indicator: serialIssue,
  });
  for (const tab of getSettingsTabsForScreen(screen)) {
    tabs.push({
      id: tab.id,
      label: tab.label,
      content: <tab.component />,
    });
  }
  tabs.push({
    id: "backup",
    label: "Backup & Restore",
    content: <BackupManager />,
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

/**
 * The Data Sources tab. Leads with the single Gonogo/Sitrep connection
 * (host/port config, connect status, setup instructions) — the app's sole
 * live telemetry source — then lists every registered mod-side Uplink's
 * self-reported health beneath it. Deliberately does NOT list every
 * registered `DataSource` the way the old `DataSourceStatusComponent` did:
 * stations don't reach this tab (`showDataSources` gates it main-only), and
 * on main there is exactly one telemetry connection to manage now — the
 * per-Uplink rows are the finer-grained detail that replaces the old
 * "other connections" list.
 */
function DataSourcesPanel() {
  return (
    <SectionStack>
      <Section>
        <SectionTitle>Game host</SectionTitle>
        <SitrepConnection />
      </Section>
      <Section>
        <SectionTitle>Uplinks</SectionTitle>
        <UplinkHealthList />
      </Section>
      <UplinkLoaderSection />
    </SectionStack>
  );
}

/**
 * Loaded Uplink CLIENTS (runtime loader path). Distinct from the Uplinks section
 * above, which reports the mod-side self-report over `system.uplinks`: this
 * reports whether each runtime-loaded client bundle passed the compat gates +
 * integrity check and registered, or was quarantined with a reason (design §2.4:
 * every refusal is legible, never a silent load). Renders nothing on the default
 * bundled path, where no client is loaded at runtime and the store is empty.
 */
function UplinkLoaderSection() {
  const outcomes = useSyncExternalStore(
    subscribeUplinkOutcomes,
    getUplinkOutcomes,
  );
  if (outcomes.length === 0) return null;
  return (
    <Section>
      <SectionTitle>Loaded clients</SectionTitle>
      <UplinkList>
        {outcomes.map((o) => (
          <UplinkItem key={o.id}>
            <ConnectionRow>
              <LoaderIndicator $status={o.status} />
              <Name>{o.name}</Name>
              {o.version && <UplinkVersion>v{o.version}</UplinkVersion>}
              <LoaderLabel $status={o.status}>{o.status}</LoaderLabel>
            </ConnectionRow>
            {o.reason && <UplinkDetail>{o.reason}</UplinkDetail>}
            {o.status === "quarantined" &&
              o.reason === "consent declined" &&
              o.version && (
                <GhostButton
                  type="button"
                  onClick={() => {
                    revokeConsent(o.id, o.version as string);
                    window.location.reload();
                  }}
                >
                  Reconsider
                </GhostButton>
              )}
          </UplinkItem>
        ))}
      </UplinkList>
    </Section>
  );
}

/**
 * Per-Uplink health rows, fed by `system.uplinkHealth` — the client-derived
 * reader over the mod's `system.uplinks` self-report (see
 * `@ksp-gonogo/sitrep-client`'s `uplink-health.ts`). Each Uplink reports its
 * OWN health; this never infers readiness from topic staleness.
 */
function UplinkHealthList() {
  const uplinkHealth = useStream<SystemUplinkHealth>("system.uplinkHealth");

  if (uplinkHealth === undefined) {
    return <Placeholder>Waiting for uplink health report...</Placeholder>;
  }
  if (uplinkHealth === null || uplinkHealth.uplinks.length === 0) {
    return <Placeholder>No uplinks registered</Placeholder>;
  }

  return (
    <UplinkList>
      {uplinkHealth.uplinks.map((entry) => (
        <UplinkRow key={entry.id} entry={entry} />
      ))}
    </UplinkList>
  );
}

function UplinkRow({ entry }: { entry: UplinkHealthEntry }) {
  const detail =
    entry.health.detail ?? (!entry.available ? entry.reason : null);
  return (
    <UplinkItem>
      <ConnectionRow>
        <HealthIndicator $state={entry.health.state} />
        <Name>{entry.id}</Name>
        <UplinkVersion>v{entry.version}</UplinkVersion>
        <HealthLabel $state={entry.health.state}>
          {entry.health.state}
        </HealthLabel>
      </ConnectionRow>
      {detail && <UplinkDetail>{detail}</UplinkDetail>}
    </UplinkItem>
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
        aria-label="Send technical analytics"
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
  // `dependsOn` is a rendering-only hint (see its doc comment in
  // registry.ts): read the parent's CURRENT value the same way this row
  // reads its own, so the row visually goes inert the instant the parent
  // toggles off — no registry-level enforcement, just an honest reflection
  // of what the consuming hook (e.g. `useMissionHistorySettings`) actually
  // does with these two values.
  const parent = def.dependsOn ? getSetting(def.dependsOn) : undefined;
  const [parentValue] = useSetting<boolean>(
    def.dependsOn ?? "__no_parent__",
    parent?.type === "boolean" ? parent.defaultValue : true,
  );
  const inert = def.dependsOn !== undefined && !parentValue;

  return (
    <Row $indented={def.dependsOn !== undefined}>
      <RowText>
        <RowLabel>{def.label}</RowLabel>
        {def.description && <RowDesc>{def.description}</RowDesc>}
      </RowText>
      <Switch
        checked={value}
        onChange={setValue}
        disabled={inert}
        aria-label={def.label}
      />
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

const Row = styled.div<{ $indented?: boolean }>`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-left: ${({ $indented }) => ($indented ? "20px" : "0")};
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

// --- Data Sources tab (per-Uplink health; ConnectionRow/Name come from
// SitrepConnection.tsx, shared with the single Gonogo/Sitrep connection
// row) ---

const UplinkList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const UplinkItem = styled.li`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const UplinkVersion = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-faint);
  white-space: nowrap;
`;

const uplinkHealthColor: Record<UplinkHealthStateName, string> = {
  healthy: "var(--color-accent-fg)",
  degraded: "var(--color-status-warning-bg)",
  unavailable: "var(--color-status-nogo-bg)",
};

const HealthIndicator = styled.span<{ $state: UplinkHealthStateName }>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: ${({ $state }) => uplinkHealthColor[$state]};
`;

const HealthLabel = styled.span<{ $state: UplinkHealthStateName }>`
  font-size: 11px;
  color: ${({ $state }) => uplinkHealthColor[$state]};
  text-transform: uppercase;
  letter-spacing: 0.05em;
`;

const UplinkDetail = styled.span`
  font-size: var(--font-size-sm);
  color: var(--color-text-dim);
  margin-left: 16px;
`;

const loaderStatusColor: Record<UplinkLoadStatus, string> = {
  loading: "var(--color-status-warning-bg)",
  loaded: "var(--color-accent-fg)",
  quarantined: "var(--color-status-nogo-bg)",
};

const LoaderIndicator = styled.span<{ $status: UplinkLoadStatus }>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: ${({ $status }) => loaderStatusColor[$status]};
`;

const LoaderLabel = styled.span<{ $status: UplinkLoadStatus }>`
  font-size: 11px;
  color: ${({ $status }) => loaderStatusColor[$status]};
  text-transform: uppercase;
  letter-spacing: 0.05em;
`;
