import { getDataSource, useScreen } from "@gonogo/core";
import { StarIcon } from "@gonogo/ui";
import { Fragment, useCallback, useEffect, useState } from "react";
import styled from "styled-components";
import type { BufferedDataSource } from "../BufferedDataSource";
import {
  DEFAULT_KEEP_COUNT,
  getKeepCount,
  setKeepCount,
} from "../flightAutoDelete";
import { useFlight } from "../hooks/useFlight";
import { getReplayController } from "../replay/ReplayController";
import type { FlightRecord } from "../types";
import { ChaptersEditor } from "./ChaptersEditor";
import { FlightGraph } from "./FlightGraph";

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

function getSource(): BufferedDataSource | undefined {
  return getDataSource("data") as BufferedDataSource | undefined;
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

export function FlightsManager() {
  const screen = useScreen();
  // Replay swaps the registered "data" source for a FlightReplayDataSource.
  // Stations register a PeerClientDataSource — replay would have nothing
  // local to swap and the controller's BufferedDataSource type guard would
  // fail. Hide the button rather than letting a click crash.
  const isMain = screen === "main";
  const currentFlight = useFlight();
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: currentFlight is a trigger, not a read inside the body — we refetch when the current flight changes
  useEffect(() => {
    void reload();
  }, [currentFlight, reload]);

  // List-shape changes (delete, star, prune, chapter ops, new-flight
  // detection) re-emit on the source. On the main screen this fires
  // synchronously from BufferedDataSource; on a station it arrives via
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
    await getReplayController().start(src, flight.id);
    // The banner takes over from here; close the modal so the dashboard
    // is visible underneath.
    setExpandedFlightId(null);
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

  if (flights.length === 0) {
    return <EmptyState>No flight history recorded yet.</EmptyState>;
  }

  const allSelected = flights.length > 0 && selectedIds.size === flights.length;
  const someSelected =
    selectedIds.size > 0 && selectedIds.size < flights.length;

  // How many flights would be pruned if the user enabled auto-delete right
  // now? Mirrors `pruneFlightsKeepLatest` exactly: starred + current are
  // exempt and don't count toward the cap, sort newest-first by launchedAt.
  const autoDeleteEligibleCount = (() => {
    const sorted = [...flights].sort((a, b) => b.launchedAt - a.launchedAt);
    let kept = 0;
    let victims = 0;
    for (const f of sorted) {
      if (f.starred || f.id === currentFlight?.id) continue;
      kept += 1;
      if (kept > DEFAULT_KEEP_COUNT) victims += 1;
    }
    return victims;
  })();

  return (
    <Container>
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
            <ThStar aria-label="Starred (exempt from auto-delete)">
              <StarIcon size={12} fill="currentColor" />
            </ThStar>
            <Th>Vessel</Th>
            <Th>Launched</Th>
            <Th>Duration</Th>
            <Th>Samples</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {flights.map((f) => {
            const isCurrent = f.id === currentFlight?.id;
            const isExpanded = expandedFlightId === f.id;
            const isSelected = selectedIds.has(f.id);
            return (
              <Fragment key={f.id}>
                <Tr $current={isCurrent}>
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
                    {isCurrent && <CurrentBadge>current</CurrentBadge>}
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
                          aria-label={`Replay flight ${f.vesselName || ""}`}
                          title="Replay this flight in the dashboard"
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
                          <DangerButton onClick={() => void handleDelete(f.id)}>
                            Delete
                          </DangerButton>
                          <CancelButton
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            Cancel
                          </CancelButton>
                        </ConfirmRow>
                      ) : (
                        <DeleteButton onClick={() => setConfirmDeleteId(f.id)}>
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
                        flightId={f.id}
                        launchedAt={f.launchedAt}
                        lastSampleAt={f.lastSampleAt}
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
            title={`Keep the ${DEFAULT_KEEP_COUNT} most recently launched flights and silently delete the rest. Starred flights and the current flight are exempt and don't count toward the cap. Runs at app startup and immediately when toggled on.`}
          >
            <SelectCheckbox
              checked={keepCount > 0}
              onChange={(e) => void handleToggleAutoDelete(e.target.checked)}
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
              <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
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
    </Container>
  );
}

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

const CurrentBadge = styled.span`
  display: inline-block;
  margin-left: 6px;
  font-size: var(--font-size-xs);
  padding: 1px 5px;
  background: var(--color-status-go-bg);
  border: 1px solid var(--color-status-go-bg);
  border-radius: 8px;
  color: var(--color-accent-fg);
  text-transform: uppercase;
  letter-spacing: 0.05em;
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
