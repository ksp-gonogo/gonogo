import {
  getSettingsTabsForScreen,
  useDataSources,
  useScreen,
  useTelemetry,
} from "@ksp-gonogo/core";
import {
  SerialDevicesMenu,
  useSerialAggregateStatus,
} from "@ksp-gonogo/serial";
import { SettingsPersistenceState } from "@ksp-gonogo/sitrep-sdk";
import { Switch, type TabDescriptor, Tabs } from "@ksp-gonogo/ui";
import { SectionTitle, Stack } from "@ksp-gonogo/ui-kit";
import { useState, useSyncExternalStore } from "react";
import styled from "styled-components";
import { analyticsConsentService } from "../analytics/AnalyticsConsentService";
import { BackupManager } from "../backup/BackupManager";
import { LogsManager } from "../logs/LogsManager";
import { GonogoSettings } from "./GonogoSettings";
import type { SettingDefinition } from "./registry";
import { getSettingsForScreen } from "./registry";
import { bucketBy, CategoryRows } from "./SettingRows";
import { SitrepConnection } from "./SitrepConnection";
import {
  Empty,
  RowDesc,
  RowLabel,
  RowText,
  SectionStack,
  SettingLine,
} from "./settingsLayout";
import { UplinksSettings, useUplinkPages } from "./UplinksSettings";

export interface SettingsModalProps {
  /** The tab to open on, such as "connection". Otherwise the first tab asking for attention. */
  initialTabId?: string;
}

/**
 * Tabbed settings surface: this screen's registered settings under General,
 * Gonogo's own settings in KSP's settings file, connection and device
 * management, one page per Uplink under Uplinks, then backup and diagnostics.
 * Each tab can raise an attention dot; the Settings FAB aggregates those dots
 * into its own badge (see SettingsFab).
 */
export function SettingsModal({ initialTabId }: SettingsModalProps = {}) {
  const screen = useScreen();
  const settings = getSettingsForScreen(screen).filter(
    (def) => def.uplink === undefined,
  );
  const uplinkPages = useUplinkPages(screen);
  // The analytics-consent toggle is host-owned, so it only appears where the
  // screen owns its own boot. Stations follow the host's consent over PeerJS
  // and have no local control.
  const showConsent = screen !== "station";
  /*
   * The connection belongs to whichever screen holds its own telemetry session.
   * A station follows the host over PeerJS and has nothing to manage; a pilot
   * holds its own direct connection to the mod, so gating on the main screen
   * would lock a pilot out of its own host setting.
   */
  const showConnection = screen !== "station";

  const sitrepSource = useDataSources().find((s) => s.id === "sitrep");
  const connectionIssue =
    showConnection &&
    (sitrepSource?.status === "disconnected" ||
      sitrepSource?.status === "error");
  const serialStatus = useSerialAggregateStatus();
  const serialIssue = serialStatus === "partial" || serialStatus === "error";
  // The Gonogo tab's dot: the settings file does not hold what is in force, or
  // could not be read. A first run with no file yet is not a problem.
  const gonogoSettings = useTelemetry("settings.gonogo");
  const gonogoIssue =
    gonogoSettings.state === "observed" || gonogoSettings.state === "held"
      ? gonogoSettings.value.persistence.state !==
          SettingsPersistenceState.Saved &&
        gonogoSettings.value.persistence.state !==
          SettingsPersistenceState.Defaults
      : false;

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
  tabs.push({
    id: "gonogo",
    label: "Gonogo",
    content: (
      <SectionStack>
        <GonogoSettings />
      </SectionStack>
    ),
    indicator: gonogoIssue,
  });
  if (showConnection) {
    tabs.push({
      id: "connection",
      label: "Connection",
      content: <ConnectionPanel />,
      indicator: connectionIssue,
    });
  }
  tabs.push({
    id: "devices",
    label: "Devices",
    content: <SerialDevicesMenu />,
    indicator: serialIssue,
  });
  for (const tab of getSettingsTabsForScreen(screen)) {
    if (tab.uplink !== undefined) continue;
    tabs.push({
      id: tab.id,
      label: tab.label,
      content: <tab.component />,
    });
  }
  if (uplinkPages.length > 0) {
    tabs.push({
      id: "uplinks",
      label: "Uplinks",
      content: <UplinksSettings pages={uplinkPages} />,
      indicator: uplinkPages.some((page) => page.attention),
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

  // An explicit initial tab wins; otherwise the first tab that wants attention, else the first tab.
  const [activeId, setActiveId] = useState(
    () =>
      initialTabId ??
      tabs.find((t) => t.indicator)?.id ??
      tabs[0]?.id ??
      "general",
  );

  if (tabs.length === 0) {
    return <Empty>No settings yet on the {screen} screen</Empty>;
  }

  return (
    <Wrap>
      <Tabs
        tabs={tabs}
        activeId={activeId}
        onChange={setActiveId}
        aria-label="Settings"
      />
    </Wrap>
  );
}

/**
 * The Connection tab: the game host this screen streams from, and whether the
 * stream is up. Each Uplink's own health is on its page under Uplinks.
 */
function ConnectionPanel() {
  return (
    <SectionStack>
      <Stack as="section" gap="related-comfortable">
        <SectionTitle as="h3" $rule>
          Game host
        </SectionTitle>
        <SitrepConnection />
      </Stack>
    </SectionStack>
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
  const byCategory = bucketBy(settings, (s) => s.category);

  return (
    <SectionStack>
      {[...byCategory.entries()].map(([category, items]) => (
        <Stack as="section" gap="related-comfortable" key={category}>
          <SectionTitle as="h3" $rule>
            {category}
          </SectionTitle>
          <CategoryRows items={items} />
        </Stack>
      ))}
      {showConsent && (
        <Stack as="section" gap="related-comfortable">
          <SectionTitle as="h3" $rule>
            Privacy
          </SectionTitle>
          <AnalyticsConsentRow />
        </Stack>
      )}
    </SectionStack>
  );
}

/**
 * Re-toggle for the technical-analytics consent the boot modal first
 * asked about. Bound directly to `analyticsConsentService` (its own
 * localStorage slot) rather than the settings registry, the boot modal,
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
    <SettingLine>
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
    </SettingLine>
  );
}

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  /* Give the tab system a workable box: wide enough for the embedded
     Connection / Devices / Diagnostics panels, and a height so a tall
     panel scrolls within the modal rather than stretching it unbounded. */
  min-width: 460px;
  max-width: 80vw;
  height: min(70vh, 640px);
  min-height: 0;
`;
