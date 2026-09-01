import {
  getDataSource,
  getSettingsTabsForScreen,
  getUplinkHandle,
  NO_TELEMETRY_HOST_MESSAGE,
  useDataSources,
  useScreen,
  useTelemetryHostDown,
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
import { isValue } from "@ksp-gonogo/sitrep-sdk";
import {
  GhostButton,
  Placeholder,
  Switch,
  type TabDescriptor,
  Tabs,
} from "@ksp-gonogo/ui";
import {
  Badge,
  Cluster,
  Input,
  NULL_DISPLAY,
  ReadOnlyField,
  SectionTitle,
  Stack,
} from "@ksp-gonogo/ui-kit";
import {
  Fragment,
  useCallback,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
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
import { UplinkIdentityBlock } from "../uplinks/UplinkIdentityBlock";
import { UplinkHubWizard } from "../wizard/UplinkHubWizard";
import { useUplinkGap } from "../wizard/useUplinkGap";
import type {
  SettingDefinition,
  SettingValue,
  SourceBackedSetting,
  StreamBackedSetting,
} from "./registry";
import {
  getSettingDefinition,
  getSettingsForScreen,
  isReadOnlySetting,
  settingTypeOf,
} from "./registry";
import { useSetting } from "./SettingsContext";
import { ConnectionRow, Name, SitrepConnection } from "./SitrepConnection";

export interface SettingsModalProps {
  /** Force the initially-active tab (e.g. "uplink-hub" for the first-run
   * auto-open host). Defaults to the existing attention-first selection. */
  initialTabId?: string;
  /** Passed through to the embedded `UplinkHubWizard`: see its own prop doc. */
  uplinkHubFirstRun?: boolean;
  /** Passed through to the embedded `UplinkHubWizard`: see its own prop doc. */
  onUplinkHubFinish?: () => void;
}

/**
 * Tabbed settings surface. Beyond the auto-rendered registered settings
 * (the "General" tab), this is also the home for connection and device
 * management: Data Sources, Devices (serial), and Diagnostics. Each tab can
 * raise an attention dot; the
 * Settings FAB aggregates those dots into its own badge (see SettingsFab).
 */
export function SettingsModal({
  initialTabId,
  uplinkHubFirstRun,
  onUplinkHubFinish,
}: SettingsModalProps = {}) {
  const screen = useScreen();
  const settings = getSettingsForScreen(screen);
  // The analytics-consent toggle is host-owned, so it only appears on the
  // main screen. Stations follow the host's consent over PeerJS and have
  // no local control.
  const showConsent = screen === "main";
  // Data-source management is main-only, stations follow the host over
  // PeerJS and have nothing to manage locally.
  const showDataSources = screen === "main";

  // Data Sources now leads with the single Gonogo/Sitrep connection (no
  // more "Other Connections" list of every registered DataSource; see
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

  // Same cross-reference the wizard itself renders, an installed Uplink the
  // Hub can offer but hasn't loaded yet is exactly what deserves the tab's
  // attention dot (design §4 Decision 1's "carries an attention badge when
  // the cross-reference finds an installed-but-unloaded Uplink with a Hub
  // entry"). Main-only, same gate as the tab itself.
  const uplinkGap = useUplinkGap();
  const uplinkHubIssue =
    showDataSources &&
    uplinkGap.entries.some((entry) => entry.state === "load-from-hub");

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
    // Loading an Uplink client is a main-screen-only action (stations never
    // talk to the mod directly, same gate as Data Sources above), hardcoded
    // here rather than via `registerSettingsTab`, which is reserved for
    // external contributions (see that hook's own doc comment).
    tabs.push({
      id: "uplink-hub",
      label: "Uplink Hub",
      content: (
        <UplinkHubWizard
          firstRun={uplinkHubFirstRun}
          onFinish={onUplinkHubFinish}
        />
      ),
      indicator: uplinkHubIssue,
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

  // An explicit initial tab (e.g. the first-run auto-open host targeting
  // "uplink-hub") wins; otherwise open on the first tab that wants
  // attention, else the first tab.
  const [activeId, setActiveId] = useState(
    () =>
      initialTabId ??
      tabs.find((t) => t.indicator)?.id ??
      tabs[0]?.id ??
      "general",
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
 * (host/port config, connect status, setup instructions): the app's sole
 * live telemetry source: then lists every registered mod-side Uplink's
 * self-reported health beneath it. Deliberately does NOT list every registered
 * `DataSource`: stations don't reach this tab (`showDataSources` gates it
 * main-only), and on main there is exactly one telemetry connection to manage,
 * with the per-Uplink rows carrying the finer-grained detail.
 */
function DataSourcesPanel() {
  return (
    <SectionStack>
      <Stack as="section" gap="md">
        <SectionTitle as="h3" $rule>
          Game host
        </SectionTitle>
        <SitrepConnection />
      </Stack>
      <Stack as="section" gap="md">
        <SectionTitle as="h3" $rule>
          Uplink health
        </SectionTitle>
        <UplinkHealthList />
      </Stack>
      <UplinkLoaderSection />
    </SectionStack>
  );
}

/**
 * Loaded Uplink CLIENTS (runtime loader path). Distinct from the Uplinks section
 * above, which reports the mod-side self-report over `system.uplinks`: this
 * reports whether each runtime-loaded client bundle passed the compat gates +
 * integrity check and registered, or was quarantined with a reason (design §2.4:
 * every refusal is legible, never a silent load). The store is empty, and this
 * renders nothing, wherever the loader attempted nothing: a station before its
 * deferred `StationUplinkLoader` pass, a boot with no mod talking and no
 * `?uplinkLoaderIds=` naming ids by hand, or that override with an empty list.
 */
function UplinkLoaderSection() {
  const outcomes = useSyncExternalStore(
    subscribeUplinkOutcomes,
    getUplinkOutcomes,
  );
  if (outcomes.length === 0) return null;
  return (
    <Stack as="section" gap="md">
      <SectionTitle as="h3" $rule>
        Loaded clients
      </SectionTitle>
      <UplinkList>
        {outcomes.map((o) => (
          <UplinkItem key={o.id}>
            <ConnectionRow>
              <LoaderIndicator $status={o.status} />
              <Name>{o.name}</Name>
              {o.version && <UplinkVersion>v{o.version}</UplinkVersion>}
              <LoaderLabel $status={o.status}>{o.status}</LoaderLabel>
            </ConnectionRow>
            {o.identity && <UplinkIdentityBlock identity={o.identity} live />}
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
    </Stack>
  );
}

/**
 * Per-Uplink health rows, fed by `system.uplinkHealth`: the client-derived
 * reader over the mod's `system.uplinks` self-report (see
 * `@ksp-gonogo/sitrep-client`'s `uplink-health.ts`). Each Uplink reports its
 * OWN health; this never infers readiness from topic staleness.
 */
function UplinkHealthList() {
  const hostDown = useTelemetryHostDown();
  const uplinkHealth = useStream<SystemUplinkHealth>("system.uplinkHealth");
  const [showHealthy, setShowHealthy] = useState(false);

  if (hostDown) {
    return <Placeholder>{NO_TELEMETRY_HOST_MESSAGE}</Placeholder>;
  }
  if (uplinkHealth === undefined) {
    return <Placeholder>Waiting for uplink health report...</Placeholder>;
  }
  if (uplinkHealth === null || uplinkHealth.uplinks.length === 0) {
    return <Placeholder>No uplinks registered</Placeholder>;
  }

  // Health is mandatory now (every uplink self-reports, 2026-07-21). Collapse a
  // plain "Healthy, nothing to say" entry into the chip below; anything
  // non-healthy, or healthy-WITH a detail string (an uplink offering more than
  // the trivial floor), stays individually visible.
  const collapsible = uplinkHealth.uplinks.filter(
    (u) => u.health.state === "healthy" && u.health.detail === null,
  );
  const alwaysVisible = uplinkHealth.uplinks.filter(
    (u) => !(u.health.state === "healthy" && u.health.detail === null),
  );

  return (
    <UplinkList>
      {alwaysVisible.map((entry) => (
        <UplinkRow key={entry.id} entry={entry} />
      ))}
      {collapsible.length > 0 && (
        <HealthySummaryItem>
          <HealthySummaryRow>
            <Badge severity="nominal">
              {collapsible.length}/{uplinkHealth.uplinks.length} healthy
            </Badge>
            <GhostButton
              type="button"
              aria-expanded={showHealthy}
              aria-controls="uplink-healthy-list"
              onClick={() => setShowHealthy((v) => !v)}
            >
              {showHealthy ? "Hide" : "Show"}
            </GhostButton>
          </HealthySummaryRow>
          {showHealthy && (
            <UplinkList id="uplink-healthy-list">
              {collapsible.map((entry) => (
                <UplinkRow key={entry.id} entry={entry} />
              ))}
            </UplinkList>
          )}
        </HealthySummaryItem>
      )}
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
      {/* A description list rather than more detail text: these are the identity
          of whatever the Uplink depends on (a file, a build, a hash), and what an
          operator does with them is copy one into a bug report. Labels the Uplink
          wrote, values the Uplink wrote, and nothing here knows what any of them
          mean. */}
      {entry.health.facts.length > 0 && (
        <UplinkFacts>
          {entry.health.facts.map((fact) => (
            <Fragment key={fact.label}>
              <UplinkFactLabel>{fact.label}</UplinkFactLabel>
              {/* An unestablished fact reads as the null placeholder rather
                  than as a blank, which an operator scans past as an alignment
                  gap. */}
              <UplinkFactValue>{fact.value ?? NULL_DISPLAY}</UplinkFactValue>
            </Fragment>
          ))}
        </UplinkFacts>
      )}
    </UplinkItem>
  );
}

/** Buckets in first-registration order, so a category's rows keep their order. */
function bucketBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = out.get(k);
    if (bucket) bucket.push(item);
    else out.set(k, [item]);
  }
  return out;
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
        <Stack as="section" gap="md" key={category}>
          <SectionTitle as="h3" $rule>
            {category}
          </SectionTitle>
          <CategoryRows items={items} />
        </Stack>
      ))}
      {showConsent && (
        <Stack as="section" gap="md">
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

/**
 * A category's rows: the ungrouped ones first, directly under the category
 * heading, then each named `group` under a sub-heading of its own.
 *
 * Ungrouped-first is what keeps a category that never declared a group looking
 * exactly as it did. It also matches how a mod's settings actually read: the
 * two or three rows everybody wants sit at the top, and the long tail files
 * itself away under a name.
 */
function CategoryRows({ items }: { items: SettingDefinition[] }) {
  const ungrouped = items.filter((s) => s.group === undefined);
  const grouped = bucketBy(
    items.filter((s) => s.group !== undefined),
    // Narrowed by the filter above; the predicate does not carry that to TS.
    (s) => s.group as string,
  );

  return (
    <>
      {ungrouped.map((def) => (
        <SettingRow key={def.id} def={def} />
      ))}
      {[...grouped.entries()].map(([group, rows]) => (
        <Stack gap="sm" key={group}>
          <GroupTitle>{group}</GroupTitle>
          {rows.map((def) => (
            <SettingRow key={def.id} def={def} />
          ))}
        </Stack>
      ))}
    </>
  );
}

function SettingRow({ def }: { def: SettingDefinition }) {
  // Split by BACKING at the component boundary (not a conditional hook): a
  // source-backed row reads/writes a DataSource via useSyncExternalStore, a
  // stream-backed one reads a Topic via useStream, a client-pref row
  // reads/writes localStorage via useSetting. Each row calls exactly one hook
  // path, so rules-of-hooks stays honest.
  if (def.backing === "stream-backed") {
    return <StreamBackedRow def={def} />;
  }
  if (def.backing === "source-backed") {
    return <SourceBackedRow def={def} />;
  }
  return <ClientPrefRow def={def} />;
}

/**
 * A stream-backed setting's row: the value arrives on a Topic and there is
 * nothing to write, so this is always a `ReadOnlyField`.
 *
 * A silent Topic and a Topic that carries no such field both land on the null
 * placeholder, which is the honest reading of both: the mod has not said.
 */
function StreamBackedRow({ def }: { def: StreamBackedSetting }) {
  const payload = useStream<unknown>(def.topic);
  return (
    <SettingReadOnlyLine $indented={def.dependsOn !== undefined}>
      <ReadOnlyField
        label={def.label}
        description={def.description}
        value={payload === undefined ? undefined : def.select(payload)}
      />
    </SettingReadOnlyLine>
  );
}

/**
 * A source-backed setting's row. Its value lives on the Uplink's `DataSource`
 * (looked up by `sourceId`), read/written through the client-supplied binding
 * closures: NEVER through `SettingsService`/localStorage. When the source
 * isn't registered the row renders inert (disabled) rather than crashing,
 * the same graceful-absence posture an absent-source-gated surface has.
 */
function SourceBackedRow({ def }: { def: SourceBackedSetting }) {
  // An Uplink's source is looked up first in the uplink-handle registry,
  // where Uplink singletons register (via `registerUplinkHandle`): then the
  // DataSource registry as a fallback for sources registered that way.
  const source: unknown =
    getUplinkHandle(def.sourceId) ?? getDataSource(def.sourceId);
  const getSnapshot = useStableSettingSnapshot(() =>
    source ? def.read(source) : undefined,
  );
  const value = useSyncExternalStore(
    (cb) => (source ? def.subscribe(source, cb) : () => {}),
    getSnapshot,
  );

  if (isReadOnlySetting(def)) {
    return (
      <SettingReadOnlyLine>
        <ReadOnlyField
          label={def.label}
          description={def.description}
          value={value}
        />
      </SettingReadOnlyLine>
    );
  }
  return (
    <SettingLine>
      <RowText>
        <RowLabel>{def.label}</RowLabel>
        {def.description && <RowDesc>{def.description}</RowDesc>}
      </RowText>
      <SettingControl
        def={def}
        value={value}
        disabled={source === undefined}
        onChange={(next) => {
          // `write` is present because `isReadOnlySetting` returned false.
          if (source) def.write?.(source, next as never);
        }}
      />
    </SettingLine>
  );
}

function ClientPrefRow({
  def,
}: {
  def: Extract<SettingDefinition, { backing?: "client-pref" }>;
}) {
  const [value, setValue] = useSetting<SettingValue>(def.id, def.defaultValue);
  // `dependsOn` is a rendering-only hint (see its doc comment in
  // registry.ts): read the parent's CURRENT value the same way this row
  // reads its own, so the row visually goes inert the instant the parent
  // toggles off: no registry-level enforcement, just an honest reflection
  // of what the consuming hook (e.g. `useMissionHistorySettings`) actually
  // does with these two values.
  const parent = def.dependsOn
    ? getSettingDefinition(def.dependsOn)
    : undefined;
  // A dependsOn parent is a client-pref boolean by construction (its value
  // lives in localStorage, which is what this row reads); a setting with no
  // localStorage default has no value to fall back to, so assume "on".
  const [parentValue] = useSetting<boolean>(
    def.dependsOn ?? "__no_parent__",
    parent !== undefined && parent.backing === undefined
      ? parent.defaultValue === true
      : true,
  );
  const inert = def.dependsOn !== undefined && !parentValue;

  if (isReadOnlySetting(def)) {
    return (
      <SettingReadOnlyLine $indented={def.dependsOn !== undefined}>
        <ReadOnlyField
          label={def.label}
          description={def.description}
          value={value}
        />
      </SettingReadOnlyLine>
    );
  }
  return (
    <SettingLine $indented={def.dependsOn !== undefined}>
      <RowText>
        <RowLabel>{def.label}</RowLabel>
        {def.description && <RowDesc>{def.description}</RowDesc>}
      </RowText>
      <SettingControl
        def={def}
        value={value}
        disabled={inert}
        onChange={setValue}
      />
    </SettingLine>
  );
}

/**
 * The control half of a WRITABLE row, chosen by the row's declared type. A
 * read-only row never reaches here: it renders a `ReadOnlyField` instead, which
 * is the whole point of the flag.
 */
function SettingControl({
  def,
  value,
  disabled,
  onChange,
}: {
  def: SettingDefinition;
  value: SettingValue | undefined;
  disabled: boolean;
  onChange: (next: SettingValue) => void;
}) {
  const type = settingTypeOf(def);
  if (type === "boolean") {
    return (
      <Switch
        checked={value === true}
        onChange={onChange}
        disabled={disabled}
        aria-label={def.label}
      />
    );
  }
  if (type === "number") {
    return (
      <SettingInput
        type="number"
        value={typeof value === "number" ? String(value) : ""}
        onChange={(e) => {
          const typed = e.target.value;
          // A mid-edit box is empty ("" is also what a number input reports for
          // anything unparseable), and `Number("")` is 0, so the emptiness has
          // to be caught before the parse or a cleared field silently persists
          // a zero. "-" and "1e" parse to NaN and are caught after it.
          if (typed.trim() === "") return;
          const next = Number(typed);
          if (Number.isFinite(next)) onChange(next);
        }}
        disabled={disabled}
        aria-label={def.label}
      />
    );
  }
  return (
    <SettingInput
      type="text"
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      aria-label={def.label}
    />
  );
}

/**
 * `useSyncExternalStore` tears the tree down with an infinite loop if
 * `getSnapshot` hands back a new object each call, and a `number` row's binding
 * is free to build its `Value` fresh on every read: `read: (s) => value("m",
 * s.tolerance)` is the natural way to write one. Nothing in the API would tell
 * the author the loop was theirs, so the previous snapshot is kept and reused
 * whenever the new one means the same thing.
 */
function useStableSettingSnapshot(
  read: () => SettingValue | undefined,
): () => SettingValue | undefined {
  const readRef = useRef(read);
  readRef.current = read;
  const last = useRef<{ snapshot: SettingValue | undefined } | undefined>(
    undefined,
  );
  return useCallback(() => {
    const next = readRef.current();
    const prev = last.current;
    if (prev !== undefined && sameSettingValue(prev.snapshot, next)) {
      return prev.snapshot;
    }
    last.current = { snapshot: next };
    return next;
  }, []);
}

function sameSettingValue(
  a: SettingValue | undefined,
  b: SettingValue | undefined,
): boolean {
  if (Object.is(a, b)) return true;
  if (isValue(a) && isValue(b)) {
    // Same rung as well as same quantity: `equals` converts, so 1 km equals
    // 1000 m, and reusing the old object across that would pin the row's
    // display to a unit the source has stopped using.
    return a.unit === b.unit && a.equals(b);
  }
  return false;
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
  gap: var(--space-16);
  overflow-y: auto;
  min-height: 0;
`;

// align="start" is what unblocked this one: the row's label must sit at the
// TOP when its control wraps to two lines, and Cluster only centred. The
// indent for a dependent setting is genuinely this modal's.
const SettingLine = styled(Cluster).attrs({
  align: "start" as const,
  gap: "xl" as const,
})<{ $indented?: boolean }>`
  /* Interpolated, so no CSS token pass reaches it. Migrated by hand onto the
     same 20 -> 16 snap the Empty padding below takes, otherwise this
     dependent-setting indent is the one 20px left in the file. */
  margin-left: ${({ $indented }) => ($indented ? "var(--space-16)" : "0")};
`;

/* A read-only row owns its own label/value pairing (a `<dl>`), so it takes the
   line's indent and width and nothing else of the switch-row furniture. */
const SettingReadOnlyLine = styled.div<{ $indented?: boolean }>`
  margin-left: ${({ $indented }) => ($indented ? "var(--space-16)" : "0")};
`;
/* A named group inside a category: an h4 under the category's h3, so the
   heading order a screen reader walks matches the nesting it is shown. */
const GroupTitle = styled.h4`
  margin: 0;
  font-size: var(--font-size-sm);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-dim);
`;
const SettingInput = styled(Input)`
  width: 10em;
  text-align: right;
  font-variant-numeric: tabular-nums;
`;
const RowText = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
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
  padding: var(--space-16);
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
  gap: var(--space-8);
`;

const HealthySummaryItem = styled.li`
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
`;

const HealthySummaryRow = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-6) 0;
`;

const UplinkItem = styled.li`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
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
  border-radius: var(--radius-circle);
  flex-shrink: 0;
  background: ${({ $state }) => uplinkHealthColor[$state]};
`;

const HealthLabel = styled.span<{ $state: UplinkHealthStateName }>`
  font-size: var(--font-size-xs);
  color: ${({ $state }) => uplinkHealthColor[$state]};
  text-transform: uppercase;
  letter-spacing: 0.05em;
`;

const UplinkDetail = styled.span`
  font-size: var(--font-size-sm);
  color: var(--color-text-dim);
  margin-left: var(--space-16);
  /* A rich self-reported detail can be long or multi-line (an uplink that offers
     more than the trivial floor, e.g. "3 cameras" / "no comms backend elected");
     render the full string, wrapping cleanly and honouring any line breaks it
     carries, rather than truncating it. */
  display: block;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: var(--line-height-body);
`;

const UplinkFacts = styled.dl`
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-2) var(--space-8);
  margin: 0 0 0 var(--space-16);
  font-size: var(--font-size-xs);
`;

const UplinkFactLabel = styled.dt`
  color: var(--color-text-faint);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
`;

const UplinkFactValue = styled.dd`
  margin: 0;
  color: var(--color-text-dim);
  /* A path or a SHA has no spaces to wrap at and would otherwise push the modal
     wide; breaking anywhere keeps the column its share of the row. */
  overflow-wrap: anywhere;
`;

const loaderStatusColor: Record<UplinkLoadStatus, string> = {
  loading: "var(--color-status-warning-bg)",
  loaded: "var(--color-accent-fg)",
  quarantined: "var(--color-status-nogo-bg)",
};

const LoaderIndicator = styled.span<{ $status: UplinkLoadStatus }>`
  width: 8px;
  height: 8px;
  border-radius: var(--radius-circle);
  flex-shrink: 0;
  background: ${({ $status }) => loaderStatusColor[$status]};
`;

const LoaderLabel = styled.span<{ $status: UplinkLoadStatus }>`
  font-size: var(--font-size-xs);
  color: ${({ $status }) => loaderStatusColor[$status]};
  text-transform: uppercase;
  letter-spacing: 0.05em;
`;
