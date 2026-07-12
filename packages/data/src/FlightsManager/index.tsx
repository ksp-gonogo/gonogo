import { getDataSource, type Screen } from "@ksp-gonogo/core";
import { StarIcon } from "@ksp-gonogo/ui";
import {
  Fragment,
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import styled from "styled-components";
import {
  DEFAULT_KEEP_COUNT,
  getKeepCount,
  setKeepCount,
} from "../flightAutoDelete";
import { getReplaySessionController } from "../replaySession/ReplaySessionController";
import type { MissionMeta } from "../storage/MissionStore";
import type { FlightRecord } from "../types";
import {
  getAutoRecordStatus,
  subscribeAutoRecordStatus,
} from "./autoRecordStatus";
import { ChaptersEditor } from "./ChaptersEditor";
import { FlightGraph } from "./FlightGraph";
import type { MissionHistorySource } from "./MissionHistorySource";

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString();
}

function formatDuration(launchedAt: number, lastSampleAt: number): string {
  const s = Math.floor((lastSampleAt - launchedAt) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m < 60) return `${m}m ${sec}s`;
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h}h ${min}m`;
}

function getSource(): MissionHistorySource | undefined {
  return getDataSource("missionHistory") as MissionHistorySource | undefined;
}

function fixtureFilename(flight: FlightRecord): string {
  const safeName = (flight.vesselName || "flight")
    .replace(/[^a-z0-9._-]+/gi, "_")
    .toLowerCase();
  const stamp = new Date(flight.launchedAt)
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace(/Z$/, "");
  return `${safeName}-${stamp}.fixture.json`;
}

function downloadJson(payload: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  // Append → click → remove keeps Firefox happy; the synchronous click
  // triggers the download immediately, then we revoke the blob URL.
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export interface FlightsManagerProps {
  /**
   * Which screen this modal is rendered on. Read from `useScreen()` by the
   * FAB and passed in explicitly because the modal portal renders above
   * the ScreenProvider — calling `useScreen()` from inside the modal body
   * falls through to the default "main".
   */
  screen?: Screen;
  /**
   * Mirrors the app-level `mission.historyEnabled` setting — this package
   * has no access to `@ksp-gonogo/app`'s `SettingsService`, so the app
   * layer (`FlightsFab`/`MainScreen`) reads the setting and passes the
   * resolved value down. Default `true` (mission history is on by
   * default). Off means `AutoRecordController` isn't capturing anything;
   * existing recordings stay listed/replayable/exportable.
   */
  missionHistoryEnabled?: boolean;
  /**
   * Mirrors `mission.recordAllTopics` — see `missionHistoryEnabled`'s doc.
   * Default `false`. Purely a display hint here (enriches the recording
   * status line); `AutoRecordController` is what actually forwards this to
   * `StreamRecorder`.
   */
  recordAllTopics?: boolean;
}

/**
 * The unified flight-history table — one list, sourced entirely from
 * `AutoRecordController`'s automatic, on-by-default recordings (2026-07-11
 * auto-record rework — see `AutoRecordController`'s own doc comment for the
 * flight-boundary approach). Replaces what used to be TWO separate panels: a
 * `BufferedDataSource`-backed always-on-capture table (star/chapters/graph/
 * export/bulk-actions/keep-latest-N) and a manual "press record"
 * `RecordingControls` flow. Every feature from both now lives on the one
 * Missions-backed table; recording itself moved out of this component
 * entirely (see `AutoRecordStatus`, this file's replacement for the old
 * record button — a read-only readout, not a control, since there's nothing
 * left for the user to press).
 *
 * Station visibility: browsing/star/chapters/graph/export/delete/bulk
 * actions/keep-latest-N are NOT gated by `isMain` — Task 4's peer RPCs
 * (`flight-rpc-request`/`query-range-request` against `"missionHistory"`)
 * make them work identically on a station via `PeerClientDataSource`. Only
 * the REPLAY action stays `isMain`-only: `ReplaySessionProvider`/
 * `ReplaySessionController` are only mounted on `MainScreen` — not a
 * data-availability gap peer RPCs could close, a screen the station
 * genuinely doesn't run. (Recording was ALSO main-only under the old manual
 * flow; now it's not rendered here at all — `AutoRecordController` mounts
 * once, on the main screen only, regardless of whether this modal is even
 * open.)
 *
 * No "current flight" badge/highlight, and no "current flight" exemption in
 * the keep-latest-N preview: Missions have no live in-progress concept (a
 * mission only exists once recording has finished) — a direct consequence
 * of the "press record, no always-on capture" decision, not a separate
 * feature cut.
 */
export function FlightsManager({
  screen = "main",
  missionHistoryEnabled = true,
  recordAllTopics = false,
}: FlightsManagerProps = {}) {
  const isMain = screen === "main";
  const [flights, setFlights] = useState<FlightRecord[]>([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [expandedFlightId, setExpandedFlightId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [keepCount, setKeepCountState] = useState<number>(() => getKeepCount());

  const reload = useCallback(async () => {
    const src = getSource();
    if (!src) return;
    let list: FlightRecord[];
    try {
      list = await src.listFlights();
    } catch (err) {
      // On stations the data source is a PeerClientDataSource that proxies
      // listFlights through PeerJS; if the link is mid-handshake or just
      // dropped, the RPC rejects. Swallow + log rather than letting an
      // uncaught promise rejection surface in the console — the modal
      // stays on its previous list and recovers on the next reload trigger
      // (flight-list-changed push, or the user reopening the modal).
      console.warn("FlightsManager: failed to load flights", err);
      return;
    }
    setFlights(list.sort((a, b) => b.launchedAt - a.launchedAt));
    // Drop selections that no longer exist after a delete/clear.
    setSelectedIds((prev) => {
      const valid = new Set<string>();
      for (const f of list) if (prev.has(f.id)) valid.add(f.id);
      return valid.size === prev.size ? prev : valid;
    });
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // List-shape changes (delete, star, prune, chapter ops, a freshly-saved
  // recording) re-emit on the source. On the main screen this fires
  // synchronously from MissionHistorySource; on a station it arrives via
  // the host's `flight-list-changed` push. Either way, refresh the table
  // so the modal stays consistent without the user reopening it.
  useEffect(() => {
    const src = getSource();
    if (typeof src?.onFlightListChange !== "function") return;
    return src.onFlightListChange(() => {
      void reload();
    });
  }, [reload]);

  const handleDelete = async (id: string) => {
    const src = getSource();
    if (!src) return;
    await src.deleteFlight(id);
    setConfirmDeleteId(null);
    await reload();
  };

  const handleExport = async (flight: FlightRecord) => {
    const src = getSource();
    if (!src) return;
    const fixture = await src.exportFlight(flight.id);
    downloadJson(fixture, fixtureFilename(flight));
  };

  const handleReplay = async (flight: FlightRecord) => {
    const src = getSource();
    if (!src) return;
    const fixture = await src.exportFlight(flight.id);
    const meta: MissionMeta = {
      id: flight.id,
      vesselName: flight.vesselName,
      launchedAt: flight.launchedAt,
      firstFrameUt: flight.firstFrameUt ?? 0,
      lastFrameUt: flight.lastFrameUt ?? 0,
      frameCount: flight.sampleCount,
    };
    getReplaySessionController().start(meta, fixture);
  };

  const handleClearAll = async () => {
    const src = getSource();
    if (!src) return;
    await src.clearAllFlights();
    setConfirmClearAll(false);
    await reload();
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) =>
      prev.size === flights.length
        ? new Set()
        : new Set(flights.map((f) => f.id)),
    );
  };

  const handleBulkDelete = async () => {
    const src = getSource();
    if (!src) return;
    // Snapshot the ids — `selectedIds` is cleared by `reload` partway through.
    const ids = Array.from(selectedIds);
    for (const id of ids) {
      await src.deleteFlight(id);
    }
    setConfirmBulkDelete(false);
    await reload();
  };

  const handleToggleStar = async (flight: FlightRecord) => {
    const src = getSource();
    if (!src) return;
    await src.setFlightStarred(flight.id, !flight.starred);
    await reload();
  };

  const handleToggleAutoDelete = async (enabled: boolean) => {
    const src = getSource();
    const next = enabled ? DEFAULT_KEEP_COUNT : 0;
    setKeepCount(next);
    setKeepCountState(next);
    if (enabled && src) {
      await src.pruneFlightsKeepLatest({ keepCount: next });
      await reload();
    }
  };

  const handleBulkExport = async () => {
    const src = getSource();
    if (!src) return;
    const ids = Array.from(selectedIds);
    const byId = new Map(flights.map((f) => [f.id, f]));
    for (const id of ids) {
      const flight = byId.get(id);
      if (!flight) continue;
      const fixture = await src.exportFlight(id);
      downloadJson(fixture, fixtureFilename(flight));
    }
  };

  const allSelected = flights.length > 0 && selectedIds.size === flights.length;
  const someSelected =
    selectedIds.size > 0 && selectedIds.size < flights.length;

  // How many flights would be pruned if the user enabled auto-delete right
  // now? Mirrors `pruneFlightsKeepLatest`/`pruneMissionsKeepLatest` exactly:
  // starred is exempt and doesn't count toward the cap, sort newest-first by
  // launchedAt.
  const autoDeleteEligibleCount = (() => {
    const sorted = [...flights].sort((a, b) => b.launchedAt - a.launchedAt);
    let kept = 0;
    let victims = 0;
    for (const f of sorted) {
      if (f.starred) continue;
      kept += 1;
      if (kept > DEFAULT_KEEP_COUNT) victims += 1;
    }
    return victims;
  })();

  return (
    <Container>
      {isMain && (
        <AutoRecordStatus
          missionHistoryEnabled={missionHistoryEnabled}
          recordAllTopics={recordAllTopics}
        />
      )}
      {flights.length === 0 ? (
        <EmptyState>No flight history recorded yet.</EmptyState>
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <ThCheckbox>
                  <SelectCheckbox
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    aria-label={
                      allSelected ? "Clear selection" : "Select all flights"
                    }
                  />
                </ThCheckbox>
                <ThStar>
                  <StarIcon size={12} fill="currentColor" aria-hidden="true" />
                  <SrOnly>Starred (exempt from auto-delete)</SrOnly>
                </ThStar>
                <Th>Vessel</Th>
                <Th>Launched</Th>
                <Th>Duration</Th>
                <Th>Samples</Th>
                <Th>
                  <SrOnly>Actions</SrOnly>
                </Th>
              </tr>
            </thead>
            <tbody>
              {flights.map((f) => {
                const isExpanded = expandedFlightId === f.id;
                const isSelected = selectedIds.has(f.id);
                return (
                  <Fragment key={f.id}>
                    <Tr $current={false}>
                      <Td>
                        <SelectCheckbox
                          checked={isSelected}
                          onChange={() => toggleSelected(f.id)}
                          aria-label={`Select flight ${f.vesselName || f.id}`}
                        />
                      </Td>
                      <Td>
                        <StarButton
                          type="button"
                          $on={Boolean(f.starred)}
                          onClick={() => void handleToggleStar(f)}
                          aria-label={
                            f.starred
                              ? `Unstar ${f.vesselName || "flight"}`
                              : `Star ${f.vesselName || "flight"} (keep from auto-delete)`
                          }
                          aria-pressed={Boolean(f.starred)}
                          title={
                            f.starred
                              ? "Starred — kept from auto-delete"
                              : "Star to keep from auto-delete"
                          }
                        >
                          <StarIcon
                            size={14}
                            fill={f.starred ? "currentColor" : "none"}
                          />
                        </StarButton>
                      </Td>
                      <Td>
                        {f.vesselName || "—"}
                        {f.outcome?.kind === "recovered" && (
                          <OutcomeBadge
                            $tone="go"
                            title={`Recovered ${f.outcome.recoveryLocation} · ${f.outcome.recoveryFactor} · +${Math.round(f.outcome.fundsEarned).toLocaleString()}f · +${f.outcome.scienceEarned.toFixed(1)} sci`}
                          >
                            recovered
                          </OutcomeBadge>
                        )}
                        {f.outcome?.kind === "crashed" && (
                          <OutcomeBadge
                            $tone="nogo"
                            title={`Crashed at ${f.outcome.body} (${f.outcome.situation}) · ${f.outcome.partsLostCount} part(s) lost${f.outcome.kerbalsKilled.length > 0 ? ` · KIA: ${f.outcome.kerbalsKilled.join(", ")}` : ""}`}
                          >
                            crashed
                          </OutcomeBadge>
                        )}
                      </Td>
                      <Td>{formatDate(f.launchedAt)}</Td>
                      <Td>{formatDuration(f.launchedAt, f.lastSampleAt)}</Td>
                      <Td>{f.sampleCount.toLocaleString()}</Td>
                      <Td>
                        <RowActions>
                          <GraphButton
                            type="button"
                            $open={isExpanded}
                            onClick={() =>
                              setExpandedFlightId(isExpanded ? null : f.id)
                            }
                            aria-label={
                              isExpanded ? "Close graph" : "Graph this flight"
                            }
                            aria-expanded={isExpanded}
                          >
                            {isExpanded ? "− graph" : "＋ graph"}
                          </GraphButton>
                          {isMain && (
                            <ReplayButton
                              type="button"
                              onClick={() => void handleReplay(f)}
                              aria-label={`Replay ${f.vesselName || "flight"}`}
                              title="Replay this mission in the dashboard"
                            >
                              ▶ replay
                            </ReplayButton>
                          )}
                          <ExportButton
                            type="button"
                            onClick={() => void handleExport(f)}
                            aria-label={`Download fixture for ${f.vesselName || "flight"}`}
                            title="Download as replay fixture (.json)"
                          >
                            ↓ fixture
                          </ExportButton>
                          {confirmDeleteId === f.id ? (
                            <ConfirmRow>
                              <DangerButton
                                onClick={() => void handleDelete(f.id)}
                              >
                                Delete
                              </DangerButton>
                              <CancelButton
                                onClick={() => setConfirmDeleteId(null)}
                              >
                                Cancel
                              </CancelButton>
                            </ConfirmRow>
                          ) : (
                            <DeleteButton
                              onClick={() => setConfirmDeleteId(f.id)}
                            >
                              ×
                            </DeleteButton>
                          )}
                        </RowActions>
                      </Td>
                    </Tr>
                    {isExpanded && (
                      <Tr $current={false}>
                        <Td colSpan={7} style={{ padding: 0 }}>
                          <ChaptersEditor
                            flight={f}
                            onChange={() => void reload()}
                          />
                          <FlightGraph
                            missionId={f.id}
                            firstFrameUt={f.firstFrameUt ?? 0}
                            lastFrameUt={f.lastFrameUt ?? 0}
                          />
                        </Td>
                      </Tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </Table>
          <Footer>
            <BulkActions>
              {selectedIds.size > 0 &&
                (confirmBulkDelete ? (
                  <ConfirmRow>
                    <span
                      style={{ fontSize: 12, color: "var(--color-text-muted)" }}
                    >
                      Delete {selectedIds.size} selected flight
                      {selectedIds.size === 1 ? "" : "s"}?
                    </span>
                    <DangerButton onClick={() => void handleBulkDelete()}>
                      Delete
                    </DangerButton>
                    <CancelButton onClick={() => setConfirmBulkDelete(false)}>
                      Cancel
                    </CancelButton>
                  </ConfirmRow>
                ) : (
                  <>
                    <SelectionCount>{selectedIds.size} selected</SelectionCount>
                    <ExportButton
                      type="button"
                      onClick={() => void handleBulkExport()}
                      title="Download fixtures for the selected flights"
                    >
                      ↓ download
                    </ExportButton>
                    <DangerButton onClick={() => setConfirmBulkDelete(true)}>
                      Delete
                    </DangerButton>
                    <CancelButton onClick={() => setSelectedIds(new Set())}>
                      Clear
                    </CancelButton>
                  </>
                ))}
            </BulkActions>
            <RightControls>
              <AutoDeleteLabel
                title={`Keep the ${DEFAULT_KEEP_COUNT} most recently launched flights and silently delete the rest. Starred flights are exempt and don't count toward the cap. Runs at app startup and immediately when toggled on.`}
              >
                <SelectCheckbox
                  checked={keepCount > 0}
                  onChange={(e) =>
                    void handleToggleAutoDelete(e.target.checked)
                  }
                />
                <span>
                  Keep latest {DEFAULT_KEEP_COUNT}
                  {keepCount === 0 && autoDeleteEligibleCount > 0 && (
                    <AutoDeleteHint>
                      {" "}
                      ({autoDeleteEligibleCount} would be deleted)
                    </AutoDeleteHint>
                  )}
                </span>
              </AutoDeleteLabel>
              {confirmClearAll ? (
                <ConfirmRow>
                  <span
                    style={{ fontSize: 12, color: "var(--color-text-muted)" }}
                  >
                    Delete all flight history?
                  </span>
                  <DangerButton onClick={() => void handleClearAll()}>
                    Clear all
                  </DangerButton>
                  <CancelButton onClick={() => setConfirmClearAll(false)}>
                    Cancel
                  </CancelButton>
                </ConfirmRow>
              ) : (
                <ClearAllButton onClick={() => setConfirmClearAll(true)}>
                  Clear all
                </ClearAllButton>
              )}
            </RightControls>
          </Footer>
        </>
      )}
    </Container>
  );
}

/**
 * Read-only recording status readout — replaces the old "press record"
 * button now that `AutoRecordController` (mounted once at `MainScreen`,
 * independent of whether this modal is even open) records every flight
 * automatically. There is deliberately no start/stop control here: a button
 * that could start a SECOND, independent `StreamRecorder` session on top of
 * the auto-recorder's would fight it (two open sessions on the same
 * `TelemetryClient`, two competing fixtures), and a "stop" button has
 * nothing well-defined to do to a recording this component doesn't own.
 * Subscribes to `autoRecordStatus`'s singleton (see that module's doc
 * comment for why a plain pub/sub instead of context) purely to show
 * whether auto-record is currently capturing — the same live feedback the
 * old record button gave, minus the gesture.
 */
function AutoRecordStatus({
  missionHistoryEnabled,
  recordAllTopics,
}: {
  missionHistoryEnabled: boolean;
  recordAllTopics: boolean;
}) {
  const status = useSyncExternalStore(
    subscribeAutoRecordStatus,
    getAutoRecordStatus,
    getAutoRecordStatus,
  );

  return (
    <RecordingToolbar>
      {missionHistoryEnabled ? (
        status.recording ? (
          // No `role="status"`/`aria-live` here deliberately — the frame
          // count updates at stream rate (~4Hz), and CLAUDE.md's
          // accessibility rule is explicit that streaming telemetry must
          // NOT be a live region (it would flood a screen reader). This is
          // a passive visual readout, not a mission-state announcement.
          <RecordingBadge>
            ● recording {status.vesselName ?? "flight"} (
            {status.frameCount.toLocaleString()} frames)
            {recordAllTopics ? " · all topics" : ""}
          </RecordingBadge>
        ) : (
          <MissionHint>
            Auto-record armed — capture starts the moment a flight begins.
          </MissionHint>
        )
      ) : (
        <MissionHint>
          Mission history is off — enable it in Settings to auto-record.
        </MissionHint>
      )}
    </RecordingToolbar>
  );
}

/**
 * Visually hidden but screen-reader-visible text — used for the icon-only
 * "Starred" and action-buttons table headers. `axe-core`'s
 * `empty-table-header` rule (unlike most accessible-name checks) only
 * counts rendered text content, not `aria-label` alone, so a `<th
 * aria-label="...">` wrapping only an icon still fails it; this is the
 * standard sr-only pattern instead.
 */
const SrOnly = styled.span`
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
`;

const Container = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 500px;
  /* Graph panels expand in-place, so let the whole thing scroll rather than
     clipping the chart. Horizontal scroll catches narrow viewports where the
     row-action button cluster won't fit even in the wide flight modal. */
  max-height: 80vh;
  overflow: auto;
`;

const RowActions = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
`;

const GraphButton = styled.button<{ $open: boolean }>`
  background: ${({ $open }) => ($open ? "var(--color-status-go-bg)" : "none")};
  border: 1px solid ${({ $open }) => ($open ? "var(--color-status-go-bg)" : "var(--color-border-strong)")};
  color: ${({ $open }) => ($open ? "var(--color-status-go-fg)" : "var(--color-text-muted)")};
  cursor: pointer;
  font-size: var(--font-size-xs);
  padding: 3px 8px;
  border-radius: 2px;
  letter-spacing: 0.06em;

  @media (hover: hover) {
    &:hover {
      border-color: var(--color-status-go-bg);
      color: var(--color-status-go-fg);
    }
  }
`;

const ExportButton = styled.button`
  background: none;
  border: 1px solid var(--color-border-strong);
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: var(--font-size-xs);
  padding: 3px 8px;
  border-radius: 2px;
  letter-spacing: 0.06em;

  @media (hover: hover) {
    &:hover {
      border-color: var(--color-tag-blue-fg);
      color: var(--color-tag-blue-fg);
    }
  }
`;

const ReplayButton = styled.button`
  background: none;
  border: 1px solid var(--color-border-strong);
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: var(--font-size-xs);
  padding: 3px 8px;
  border-radius: 2px;
  letter-spacing: 0.06em;

  @media (hover: hover) {
    &:hover {
      border-color: var(--color-tag-purple-fg);
      color: var(--color-tag-purple-fg);
    }
  }
`;

const RecordingToolbar = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding-bottom: 10px;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--color-border-subtle);
`;

const MissionHint = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-faint);
`;

const RecordingBadge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--color-status-nogo-bg);
  border: 1px solid var(--color-status-nogo-bg);
  color: var(--color-status-nogo-fg);
  font-size: var(--font-size-xs);
  padding: 4px 10px;
  border-radius: 2px;
  letter-spacing: 0.06em;
`;

const Table = styled.table`
  border-collapse: collapse;
  width: 100%;
  overflow-y: auto;
  font-size: 12px;
`;

const Th = styled.th`
  text-align: left;
  padding: 6px 8px;
  font-size: var(--font-size-xs);
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-faint);
  border-bottom: 1px solid var(--color-border-subtle);
`;

const Tr = styled.tr<{ $current: boolean }>`
  background: ${({ $current }) => ($current ? "var(--color-status-go-bg)" : "transparent")};
  &:hover { background: var(--color-surface-raised); }
`;

const Td = styled.td`
  padding: 7px 8px;
  color: var(--color-text-primary);
  border-bottom: 1px solid var(--color-surface-raised);
  white-space: nowrap;
`;

const OutcomeBadge = styled.span<{ $tone: "go" | "nogo" }>`
  display: inline-block;
  margin-left: 6px;
  font-size: var(--font-size-xs);
  padding: 1px 5px;
  border-radius: 8px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  cursor: help;
  background: ${(p) =>
    p.$tone === "go"
      ? "var(--color-status-go-bg)"
      : "var(--color-status-nogo-bg)"};
  border: 1px solid
    ${(p) =>
      p.$tone === "go"
        ? "var(--color-status-go-bg)"
        : "var(--color-status-nogo-bg)"};
  color: ${(p) =>
    p.$tone === "go"
      ? "var(--color-status-go-fg)"
      : "var(--color-status-nogo-fg)"};
`;

const DeleteButton = styled.button`
  background: none;
  border: none;
  color: var(--color-text-faint);
  cursor: pointer;
  font-size: 16px;
  padding: 0 4px;
  &:hover { color: var(--color-status-nogo-bg); }
`;

const ConfirmRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`;

const DangerButton = styled.button`
  background: var(--color-tag-dark-brown-bg);
  border: 1px solid var(--color-status-alert-muted);
  color: var(--color-tag-red-fg);
  cursor: pointer;
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 2px;
  &:hover { background: var(--color-status-alert-muted); }
`;

const CancelButton = styled.button`
  background: none;
  border: 1px solid var(--color-border-strong);
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 2px;
  &:hover { color: var(--color-text-primary); }
`;

const Footer = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 10px 8px 4px;
  border-top: 1px solid var(--color-border-subtle);
`;

const BulkActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
`;

const SelectionCount = styled.span`
  font-size: 11px;
  color: var(--color-text-muted);
  letter-spacing: 0.06em;
  text-transform: uppercase;
`;

const ThCheckbox = styled.th`
  width: 28px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--color-border-subtle);
`;

const SelectCheckbox = styled.input.attrs({ type: "checkbox" })`
  cursor: pointer;
  margin: 0;
`;

const ThStar = styled.th`
  width: 24px;
  padding: 6px 4px;
  font-size: 12px;
  color: var(--color-text-faint);
  border-bottom: 1px solid var(--color-border-subtle);
  text-align: center;
`;

const StarButton = styled.button<{ $on: boolean }>`
  background: none;
  border: none;
  cursor: pointer;
  padding: 0 2px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: ${({ $on }) =>
    $on ? "var(--color-tag-yellow-fg, gold)" : "var(--color-text-faint)"};

  @media (hover: hover) {
    &:hover {
      color: var(--color-tag-yellow-fg, gold);
    }
  }
`;

const RightControls = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;

const AutoDeleteLabel = styled.label`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--color-text-muted);
  cursor: pointer;
  user-select: none;
`;

const AutoDeleteHint = styled.span`
  color: var(--color-status-alert-muted);
`;

const ClearAllButton = styled.button`
  background: none;
  border: 1px solid var(--color-border-strong);
  color: var(--color-text-dim);
  cursor: pointer;
  font-size: 11px;
  padding: 4px 12px;
  border-radius: 2px;
  &:hover { color: var(--color-tag-red-fg); border-color: var(--color-status-alert-muted); }
`;

const EmptyState = styled.div`
  padding: 24px 16px;
  font-size: 12px;
  color: var(--color-text-faint);
  text-align: center;
`;
