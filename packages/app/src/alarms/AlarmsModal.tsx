import { useDataSchema } from "@gonogo/data";
import {
  DataKeyPicker,
  Field,
  FieldHint,
  FieldLabel,
  GhostButton,
  Input,
  PrimaryButton,
} from "@gonogo/ui";
import { useEffect, useRef, useState } from "react";
import styled from "styled-components";
import type { Alarm, AlarmSnapshot, AlarmTrigger, ThresholdOp } from "./types";
import {
  DEFAULT_LEAD_SECONDS,
  DEFAULT_SUSTAIN_SECONDS,
} from "./types";

/**
 * CRUD UI for the alarm list. Intentionally screen-agnostic — accepts a
 * snapshot + command callbacks so both main and station mount the same
 * component from different service backends.
 *
 * v2 — supports both time and threshold triggers via a kind selector.
 */

export interface AlarmsModalProps {
  /**
   * Read the latest snapshot. The modal calls this every render so it
   * stays in sync with live UT — captured snapshot props go stale once
   * the modal is open and produce time alarms anchored to the open-time
   * UT (the second alarm in a session would fire instantly).
   */
  useSnapshot: () => AlarmSnapshot;
  onAdd: (input: {
    name: string;
    notes?: string;
    trigger: AlarmTrigger;
  }) => void;
  onUpdate: (
    id: string,
    patch: Partial<Pick<Alarm, "name" | "notes" | "trigger">>,
  ) => void;
  onDelete: (id: string) => void;
}

type DraftKind = "time" | "threshold";
const THRESHOLD_OPS: ThresholdOp[] = [">", ">=", "<", "<=", "==", "!="];

export function AlarmsModal({
  useSnapshot,
  onAdd,
  onUpdate,
  onDelete,
}: AlarmsModalProps) {
  const snapshot = useSnapshot();
  const schema = useDataSchema("data");
  // Numeric-only keys — threshold alarms compare against a number, so
  // hide enums, booleans, opaque structs and untyped raws.
  const numericKeys = schema.filter(
    (k) =>
      k.unit !== "bool" &&
      k.unit !== "enum" &&
      k.unit !== "raw" &&
      k.group !== "Actions",
  );
  // Mirror snapshot in a ref so the add handler reads the freshest value
  // when the user clicks (rules of hooks forbid calling useSnapshot inside
  // a handler). Without this, two quick adds anchor to the same UT.
  const snapshotRef = useRef(snapshot);
  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);
  const [justAddedName, setJustAddedName] = useState<string | null>(null);
  // Clear the "Added" toast after a few seconds.
  useEffect(() => {
    if (justAddedName === null) return;
    const t = setTimeout(() => setJustAddedName(null), 3000);
    return () => clearTimeout(t);
  }, [justAddedName]);
  const [kind, setKind] = useState<DraftKind>("time");
  const [name, setName] = useState("");
  // Time-trigger fields
  const [offsetSeconds, setOffsetSeconds] = useState("60");
  const [leadSeconds, setLeadSeconds] = useState(String(DEFAULT_LEAD_SECONDS));
  // Threshold-trigger fields
  const [dataKey, setDataKey] = useState("v.altitude");
  const [op, setOp] = useState<ThresholdOp>(">=");
  const [thresholdValue, setThresholdValue] = useState("70000");
  const [sustainSeconds, setSustainSeconds] = useState(
    String(DEFAULT_SUSTAIN_SECONDS),
  );

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const offsetN = Number.parseFloat(offsetSeconds);
  const valueN = Number.parseFloat(thresholdValue);
  const trimmedName = name.trim();
  const trimmedKey = dataKey.trim();
  const addDisabled =
    trimmedName === "" ||
    (kind === "time" &&
      (!Number.isFinite(offsetN) || offsetN <= 0 || snapshot.ut === null)) ||
    (kind === "threshold" &&
      (trimmedKey === "" || !Number.isFinite(valueN)));

  const handleAdd = () => {
    if (addDisabled) return;
    let trigger: AlarmTrigger;
    if (kind === "time") {
      // Read UT live from the ref — using the destructured `snapshot`
      // could anchor the trigger to a stale UT if the user adds two alarms
      // in quick succession (the modal re-renders on snapshot updates,
      // but a click handler closes over its render-time snapshot).
      const liveUt = snapshotRef.current.ut ?? 0;
      const ut = liveUt + offsetN;
      const lead = Number.parseFloat(leadSeconds);
      trigger = {
        kind: "time",
        ut,
        leadSeconds:
          Number.isFinite(lead) && lead > 0 ? lead : DEFAULT_LEAD_SECONDS,
      };
    } else {
      const sustain = Number.parseFloat(sustainSeconds);
      trigger = {
        kind: "threshold",
        dataKey: trimmedKey,
        op,
        value: valueN,
        sustainSeconds:
          Number.isFinite(sustain) && sustain >= 0
            ? sustain
            : DEFAULT_SUSTAIN_SECONDS,
      };
    }
    onAdd({ name: trimmedName, trigger });
    setJustAddedName(trimmedName);
    setName("");
    if (kind === "time") setOffsetSeconds("60");
  };

  const sorted = [...snapshot.alarms].sort((a, b) => sortKey(a) - sortKey(b));

  return (
    <Wrap>
      <Section>
        <SectionTitle>Add alarm</SectionTitle>
        <KindRow role="tablist" aria-label="Trigger kind">
          <KindButton
            type="button"
            role="tab"
            aria-selected={kind === "time"}
            $active={kind === "time"}
            onClick={() => setKind("time")}
          >
            At UT
          </KindButton>
          <KindButton
            type="button"
            role="tab"
            aria-selected={kind === "threshold"}
            $active={kind === "threshold"}
            onClick={() => setKind("threshold")}
          >
            When telemetry…
          </KindButton>
        </KindRow>

        <Field>
          <FieldLabel htmlFor="alarm-name">Name</FieldLabel>
          <Input
            id="alarm-name"
            type="text"
            placeholder={
              kind === "time"
                ? "e.g. Circularise burn"
                : "e.g. Crossed 70 km"
            }
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
            }}
          />
        </Field>

        {kind === "time" ? (
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
        ) : (
          <>
            <Field>
              <FieldLabel htmlFor="alarm-data-key">Telemetry key</FieldLabel>
              <DataKeyPicker
                keys={numericKeys}
                value={dataKey || null}
                onChange={(k) => setDataKey(k ?? "")}
                placeholder="Search telemetry…"
                clearable
              />
              <FieldHint>
                Any Telemachus key that returns a number — e.g.{" "}
                <code>v.altitude</code>, <code>v.surfaceVelocity</code>,{" "}
                <code>v.verticalSpeed</code>.
              </FieldHint>
            </Field>
            <SideBySide>
              <Field>
                <FieldLabel htmlFor="alarm-op">Operator</FieldLabel>
                <OpSelect
                  id="alarm-op"
                  value={op}
                  onChange={(e) => setOp(e.target.value as ThresholdOp)}
                >
                  {THRESHOLD_OPS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </OpSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="alarm-value">Value</FieldLabel>
                <Input
                  id="alarm-value"
                  type="number"
                  step="any"
                  value={thresholdValue}
                  onChange={(e) => setThresholdValue(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="alarm-sustain">Sustain (s)</FieldLabel>
                <Input
                  id="alarm-sustain"
                  type="number"
                  min="0"
                  step="0.5"
                  value={sustainSeconds}
                  onChange={(e) => setSustainSeconds(e.target.value)}
                />
                <FieldHint>0 = fire on first match.</FieldHint>
              </Field>
            </SideBySide>
          </>
        )}

        <PrimaryButton onClick={handleAdd} disabled={addDisabled}>
          Add alarm
        </PrimaryButton>
        {justAddedName !== null && (
          <AddedNote role="status" aria-live="polite">
            Added “{justAddedName}”. Type another name to add a second alarm.
          </AddedNote>
        )}
        {kind === "time" && snapshot.ut === null && (
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
              const pendingDelete = pendingDeleteId === a.id;
              const renaming = renamingId === a.id;
              const commitRename = () => {
                const trimmed = renameDraft.trim();
                if (trimmed && trimmed !== a.name)
                  onUpdate(a.id, { name: trimmed });
                setRenamingId(null);
                setRenameDraft("");
              };
              return (
                <Row key={a.id} $state={a.state}>
                  <RowInfo>
                    {renaming ? (
                      <Input
                        type="text"
                        value={renameDraft}
                        autoFocus
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename();
                          if (e.key === "Escape") {
                            setRenamingId(null);
                            setRenameDraft("");
                          }
                        }}
                      />
                    ) : (
                      <RowName>
                        <KindBadge>
                          {a.trigger.kind === "time" ? "TIME" : "COND"}
                        </KindBadge>
                        {a.name}
                      </RowName>
                    )}
                    <RowMeta>{describeTrigger(a, snapshot.ut)}</RowMeta>
                    <RowMeta>
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
                            setRenamingId(a.id);
                            setRenameDraft(a.name);
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

function sortKey(a: Alarm): number {
  // Time alarms sort by their UT; threshold alarms have no canonical UT,
  // so they fall to the end of the list (still alphabetised by id within
  // the bucket because Array.sort is stable in modern engines).
  return a.trigger.kind === "time" ? a.trigger.ut : Number.POSITIVE_INFINITY;
}

function describeTrigger(a: Alarm, utNow: number | null): React.ReactNode {
  if (a.trigger.kind === "time") {
    const delta = utNow !== null ? a.trigger.ut - utNow : null;
    return (
      <>
        {formatUt(a.trigger.ut)}
        {delta !== null && (
          <>
            {" · "}
            {delta >= 0 ? "T−" : "T+"}
            {formatSeconds(Math.abs(delta))}
          </>
        )}
        {" · lead "}
        {a.trigger.leadSeconds}s
      </>
    );
  }
  const t = a.trigger;
  const matchInfo =
    a.matchSinceUT != null && utNow != null
      ? ` · matched ${formatSeconds(utNow - a.matchSinceUT)} (need ${t.sustainSeconds}s)`
      : t.sustainSeconds > 0
        ? ` · sustain ${t.sustainSeconds}s`
        : "";
  return (
    <code>
      {t.dataKey} {t.op} {t.value}
      {matchInfo}
    </code>
  );
}

function formatUt(s: number): string {
  if (!Number.isFinite(s)) return "—";
  const d = Math.floor(s / 21600);
  const rem = s - d * 21600;
  const h = Math.floor(rem / 3600);
  const m = Math.floor((rem - h * 3600) / 60);
  const sec = Math.floor(rem - h * 3600 - m * 60);
  return `Y1 D${d + 1} ${h.toString().padStart(2, "0")}:${m
    .toString()
    .padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
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
  gap: 16px;
  min-width: 480px;
  max-width: 640px;
`;

const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const SectionTitle = styled.h3`
  margin: 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #888;
`;

const KindRow = styled.div`
  display: flex;
  gap: 4px;
  border: 1px solid #2a2a2a;
  border-radius: 4px;
  padding: 2px;
  background: #0a0a0a;
  width: fit-content;
`;

const KindButton = styled.button<{ $active: boolean }>`
  background: ${(p) => (p.$active ? "#1f3d2a" : "transparent")};
  color: ${(p) => (p.$active ? "#9bf0c0" : "#888")};
  border: none;
  padding: 4px 12px;
  border-radius: 3px;
  font-family: monospace;
  font-size: 11px;
  cursor: pointer;
  &:hover {
    color: #cfe;
  }
  &:focus-visible {
    outline: 2px solid #00ff88;
    outline-offset: 2px;
  }
`;

const SideBySide = styled.div`
  display: flex;
  gap: 12px;
  & > * {
    flex: 1;
  }
`;

const OpSelect = styled.select`
  font-family: monospace;
  font-size: 12px;
  padding: 4px 6px;
  background: #0d0d0d;
  color: #cfe;
  border: 1px solid #2a2a2a;
  border-radius: 3px;
`;

const WaitingNote = styled.div`
  color: #888;
  font-size: 11px;
`;

const AddedNote = styled.div`
  color: #9bf0c0;
  font-size: 11px;
`;

const Empty = styled.div`
  color: #666;
  font-size: 12px;
  padding: 12px 0;
`;

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const Row = styled.li<{ $state: Alarm["state"] }>`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  background: #111;
  border: 1px solid
    ${(p) =>
      p.$state === "firing"
        ? "#ef5350"
        : p.$state === "arming"
          ? "#ffa726"
          : "#1f1f1f"};
  border-radius: 3px;
`;

const RowInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
`;

const RowName = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: monospace;
  font-size: 13px;
  color: #cfe;
`;

const KindBadge = styled.span`
  font-size: 9px;
  letter-spacing: 0.08em;
  color: #777;
  background: #1a1a1a;
  border: 1px solid #2a2a2a;
  padding: 1px 4px;
  border-radius: 999px;
`;

const RowMeta = styled.div`
  font-family: monospace;
  font-size: 11px;
  color: #888;
  code {
    color: #cfe;
  }
`;

const StateTag = styled.span<{ $state: Alarm["state"] }>`
  text-transform: uppercase;
  font-size: 10px;
  letter-spacing: 0.08em;
  color: ${(p) =>
    p.$state === "firing"
      ? "#ef5350"
      : p.$state === "arming"
        ? "#ffa726"
        : p.$state === "fired"
          ? "#666"
          : "#9bf0c0"};
`;

const RowActions = styled.div`
  display: flex;
  gap: 4px;
  flex-shrink: 0;
`;

const DangerButton = styled.button`
  background: #4a0e0e;
  color: #ef5350;
  border: 1px solid #5a1010;
  padding: 3px 10px;
  border-radius: 3px;
  font-family: monospace;
  font-size: 11px;
  cursor: pointer;
  &:hover {
    background: #5a1010;
  }
  &:focus-visible {
    outline: 2px solid #ef5350;
    outline-offset: 2px;
  }
`;
