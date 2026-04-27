import { getDataSource } from "@gonogo/core";
import { Fragment, useCallback, useEffect, useState } from "react";
import styled from "styled-components";
import type { BufferedDataSource } from "../BufferedDataSource";
import { useFlight } from "../hooks/useFlight";
import type { FlightRecord } from "../types";
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

export function FlightsManager() {
  const currentFlight = useFlight();
  const [flights, setFlights] = useState<FlightRecord[]>([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [expandedFlightId, setExpandedFlightId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const src = getSource();
    if (!src) return;
    const list = await src.listFlights();
    setFlights(list.sort((a, b) => b.launchedAt - a.launchedAt));
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: currentFlight is a trigger, not a read inside the body — we refetch when the current flight changes
  useEffect(() => {
    void reload();
  }, [currentFlight, reload]);

  const handleDelete = async (id: string) => {
    const src = getSource();
    if (!src) return;
    await src.deleteFlight(id);
    setConfirmDeleteId(null);
    await reload();
  };

  const handleClearAll = async () => {
    const src = getSource();
    if (!src) return;
    await src.clearAllFlights();
    setConfirmClearAll(false);
    await reload();
  };

  if (flights.length === 0) {
    return <EmptyState>No flight history recorded yet.</EmptyState>;
  }

  return (
    <Container>
      <Table>
        <thead>
          <tr>
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
            return (
              <Fragment key={f.id}>
                <Tr $current={isCurrent}>
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
                    <Td colSpan={5} style={{ padding: 0 }}>
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
      </Footer>
    </Container>
  );
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 500px;
  /* Graph panels expand in-place, so let the whole thing scroll rather than
     clipping the chart. */
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
  justify-content: flex-end;
  padding: 10px 8px 4px;
  border-top: 1px solid var(--color-border-subtle);
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
