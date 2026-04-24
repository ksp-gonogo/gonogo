import {
  Button,
  Field,
  FieldHint,
  FieldLabel,
  GhostButton,
  Input,
  PrimaryButton,
} from "@gonogo/ui";
import { useState } from "react";
import styled from "styled-components";
import type { Alarm, AlarmSnapshot } from "./types";
import { DEFAULT_LEAD_SECONDS } from "./types";

/**
 * CRUD UI for the alarm list. Intentionally screen-agnostic — accepts a
 * snapshot + command callbacks so both main and station mount the same
 * component from different service backends.
 */

export interface AlarmsModalProps {
  snapshot: AlarmSnapshot;
  onAdd: (input: {
    ut: number;
    name: string;
    notes?: string;
    leadSeconds?: number;
  }) => void;
  onUpdate: (
    id: string,
    patch: Partial<Pick<Alarm, "ut" | "name" | "notes" | "leadSeconds">>,
  ) => void;
  onDelete: (id: string) => void;
}

export function AlarmsModal({
  snapshot,
  onAdd,
  onUpdate,
  onDelete,
}: AlarmsModalProps) {
  const [name, setName] = useState("");
  const [offsetSeconds, setOffsetSeconds] = useState("60");
  const [leadSeconds, setLeadSeconds] = useState(String(DEFAULT_LEAD_SECONDS));
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const addDisabled =
    name.trim() === "" ||
    Number.isNaN(Number.parseFloat(offsetSeconds)) ||
    Number.parseFloat(offsetSeconds) <= 0 ||
    snapshot.ut === null;

  const handleAdd = () => {
    if (addDisabled) return;
    const ut = (snapshot.ut ?? 0) + Number.parseFloat(offsetSeconds);
    const lead = Number.parseFloat(leadSeconds);
    onAdd({
      ut,
      name: name.trim(),
      leadSeconds:
        Number.isFinite(lead) && lead > 0 ? lead : DEFAULT_LEAD_SECONDS,
    });
    setName("");
    setOffsetSeconds("60");
  };

  const sorted = [...snapshot.alarms].sort((a, b) => a.ut - b.ut);

  return (
    <Wrap>
      <Section>
        <SectionTitle>Add alarm</SectionTitle>
        <Field>
          <FieldLabel htmlFor="alarm-name">Name</FieldLabel>
          <Input
            id="alarm-name"
            type="text"
            placeholder="e.g. Circularise burn"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
            }}
          />
        </Field>
        <SideBySide>
          <Field>
            <FieldLabel htmlFor="alarm-offset">
              Fires in (seconds from now)
            </FieldLabel>
            <Input
              id="alarm-offset"
              type="number"
              min="1"
              step="1"
              value={offsetSeconds}
              onChange={(e) => setOffsetSeconds(e.target.value)}
            />
            {snapshot.ut !== null && (
              <FieldHint>
                UT at trigger:{" "}
                {formatUt(
                  snapshot.ut + Number.parseFloat(offsetSeconds || "0"),
                )}
              </FieldHint>
            )}
          </Field>
          <Field>
            <FieldLabel htmlFor="alarm-lead">Lead time (s)</FieldLabel>
            <Input
              id="alarm-lead"
              type="number"
              min="1"
              step="1"
              value={leadSeconds}
              onChange={(e) => setLeadSeconds(e.target.value)}
            />
            <FieldHint>
              Warp drops to 1× this many seconds before trigger.
            </FieldHint>
          </Field>
        </SideBySide>
        <PrimaryButton onClick={handleAdd} disabled={addDisabled}>
          Add alarm
        </PrimaryButton>
        {snapshot.ut === null && (
          <WaitingNote>
            Waiting for Telemachus's universal-time reading before new alarms
            can be scheduled.
          </WaitingNote>
        )}
      </Section>

      <Section>
        <SectionTitle>Scheduled ({sorted.length})</SectionTitle>
        {sorted.length === 0 ? (
          <Empty>No alarms set.</Empty>
        ) : (
          <List>
            {sorted.map((a) => {
              const delta = snapshot.ut !== null ? a.ut - snapshot.ut : null;
              const pendingDelete = pendingDeleteId === a.id;
              return (
                <Row key={a.id} $state={a.state}>
                  <RowInfo>
                    <RowName>{a.name}</RowName>
                    <RowMeta>
                      {formatUt(a.ut)}
                      {delta !== null && (
                        <>
                          {" · "}
                          {delta >= 0 ? "T−" : "T+"}
                          {formatSeconds(Math.abs(delta))}
                        </>
                      )}
                      {" · lead "}
                      {a.leadSeconds}s{" · "}
                      <StateTag $state={a.state}>{a.state}</StateTag>
                    </RowMeta>
                  </RowInfo>
                  <RowActions>
                    {pendingDelete ? (
                      <>
                        <GhostButton
                          type="button"
                          onClick={() => setPendingDeleteId(null)}
                        >
                          Cancel
                        </GhostButton>
                        <DangerButton
                          type="button"
                          onClick={() => {
                            onDelete(a.id);
                            setPendingDeleteId(null);
                          }}
                        >
                          Delete
                        </DangerButton>
                      </>
                    ) : (
                      <>
                        <GhostButton
                          type="button"
                          onClick={() => {
                            const raw = prompt("New name", a.name);
                            if (raw !== null && raw.trim() !== "")
                              onUpdate(a.id, { name: raw.trim() });
                          }}
                        >
                          Rename
                        </GhostButton>
                        <GhostButton
                          type="button"
                          onClick={() => setPendingDeleteId(a.id)}
                        >
                          Delete
                        </GhostButton>
                      </>
                    )}
                  </RowActions>
                </Row>
              );
            })}
          </List>
        )}
      </Section>
    </Wrap>
  );
}

function formatUt(ut: number): string {
  if (!Number.isFinite(ut)) return "—";
  const rounded = Math.round(ut);
  const d = Math.floor(rounded / 86_400);
  const h = Math.floor((rounded % 86_400) / 3600);
  const m = Math.floor((rounded % 3600) / 60);
  const s = rounded % 60;
  return `${d}d ${h.toString().padStart(2, "0")}:${m
    .toString()
    .padStart(2, "0")}:${s.toString().padStart(2, "0")} UT`;
}

function formatSeconds(s: number): string {
  if (s < 60) return `${s.toFixed(0)}s`;
  const m = Math.floor(s / 60);
  const sec = Math.round(s - m * 60);
  if (m < 60) return `${m}m ${sec.toString().padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${(m - h * 60).toString().padStart(2, "0")}m`;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-width: 420px;
`;

const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const SectionTitle = styled.h3`
  margin: 0;
  font-family: monospace;
  font-size: var(--font-size-sm, 11px);
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #888;
  padding-bottom: 4px;
  border-bottom: 1px solid #222;
`;

const SideBySide = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
`;

const WaitingNote = styled.p`
  margin: 0;
  font-family: monospace;
  font-size: var(--font-size-sm, 11px);
  color: #666;
`;

const Empty = styled.div`
  color: #555;
  font-family: monospace;
  font-size: var(--font-size-sm, 11px);
  padding: 8px 0;
`;

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const STATE_BORDER: Record<Alarm["state"], string> = {
  pending: "#222",
  arming: "#ffae42",
  firing: "#ff4d4d",
  fired: "#333",
};

const Row = styled.div<{ $state: Alarm["state"] }>`
  background: #161616;
  border: 1px solid ${({ $state }) => STATE_BORDER[$state]};
  border-radius: 3px;
  padding: 8px 12px;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
`;

const RowInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
`;

const RowName = styled.span`
  font-family: monospace;
  font-size: var(--font-size-base, 13px);
  color: #ccc;
  font-weight: 600;
`;

const RowMeta = styled.span`
  font-family: monospace;
  font-size: var(--font-size-sm, 11px);
  color: #666;
`;

const StateTag = styled.span<{ $state: Alarm["state"] }>`
  color: ${({ $state }) => (STATE_BORDER[$state] === "#222" ? "#666" : STATE_BORDER[$state])};
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
`;

const RowActions = styled.div`
  display: flex;
  gap: 6px;
`;

const DangerButton = styled(Button)`
  background: #3a0a0a;
  border-color: #ff4d4d;
  color: #ffdede;
`;
