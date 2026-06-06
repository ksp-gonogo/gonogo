import { ACTION_GROUPS, useDataValue } from "@gonogo/core";
import { useDataSchema, useManeuverNodes } from "@gonogo/data";
import {
  Badge,
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
import type {
  Alarm,
  AlarmFireAction,
  AlarmSnapshot,
  AlarmTrigger,
  ThresholdOp,
} from "./types";
import { DEFAULT_LEAD_SECONDS, DEFAULT_SUSTAIN_SECONDS } from "./types";

/**
 * Prefilled state for opening the modal in "create with hint" mode — the
 * ActionGroup widget's bell button uses this to drop the operator into a
 * draft that already has the action group attached, leaving them only the
 * trigger to fill in.
 */
export interface AlarmDraftPrefill {
  name?: string;
  onFire?: AlarmFireAction[];
}

// Pickable telemetry actions for `onFire`. Filter out the synthetic entries
// without a `toggle` key (e.g. Precision Control), since dispatching them
// would be a no-op.
const FIRABLE_ACTIONS = ACTION_GROUPS.filter(
  (g): g is typeof g & { toggle: string } => typeof g.toggle === "string",
);

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
    onFire?: AlarmFireAction[];
  }) => void;
  onUpdate: (
    id: string,
    patch: Partial<Pick<Alarm, "name" | "notes" | "trigger" | "onFire">>,
  ) => void;
  onDelete: (id: string) => void;
  /**
   * Optional prefill applied to the draft on first mount. Lets callers
   * seed the form with a name + onFire so the operator only has to choose
   * the trigger.
   */
  prefill?: AlarmDraftPrefill;
}

type DraftKind = "time" | "threshold";
const THRESHOLD_OPS: ThresholdOp[] = [">", ">=", "<", "<=", "==", "!="];

export function AlarmsModal({
  useSnapshot,
  onAdd,
  onUpdate,
  onDelete,
  prefill,
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
  const [name, setName] = useState(prefill?.name ?? "");
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
  // Side-effect attachments. `onFire` order is the dispatch order at fire
  // time; rely on add-order for v1 (no reorder UI yet).
  const [draftOnFire, setDraftOnFire] = useState<AlarmFireAction[]>(
    () => prefill?.onFire ?? [],
  );
  const [pickerAction, setPickerAction] = useState<string>(
    FIRABLE_ACTIONS[0]?.toggle ?? "",
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
    (kind === "threshold" && (trimmedKey === "" || !Number.isFinite(valueN)));

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
    onAdd({
      name: trimmedName,
      trigger,
      onFire: draftOnFire.length > 0 ? draftOnFire : undefined,
    });
    setJustAddedName(trimmedName);
    setName("");
    setDraftOnFire([]);
    if (kind === "time") setOffsetSeconds("60");
  };

  const addPickerAction = () => {
    if (!pickerAction) return;
    // Allow duplicates — operators sometimes intentionally fire the same
    // action twice (e.g. f.stage to drop two stages on different alarms is
    // covered by separate alarms, but this row is order-preserving so we
    // don't second-guess them).
    setDraftOnFire((prev) => [
      ...prev,
      { kind: "action-group", action: pickerAction },
    ]);
  };

  const removeDraftAt = (idx: number) => {
    setDraftOnFire((prev) => prev.filter((_, i) => i !== idx));
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
              kind === "time" ? "e.g. Circularise burn" : "e.g. Crossed 70 km"
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

        <OnFireEditor
          value={draftOnFire}
          onRemove={removeDraftAt}
          pickerValue={pickerAction}
          onPickerChange={setPickerAction}
          onAdd={addPickerAction}
        />

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

      <RecommendedPresets snapshotRef={snapshotRef} onAdd={onAdd} />

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
                        <Badge tone="neutral" size="md">
                          {a.trigger.kind === "time" ? "TIME" : "COND"}
                        </Badge>
                        {a.name}
                        {a.onFire && a.onFire.length > 0 && (
                          <Badge tone="info" size="sm">
                            {a.onFire.length === 1
                              ? "FIRES 1 ACTION"
                              : `FIRES ${a.onFire.length} ACTIONS`}
                          </Badge>
                        )}
                      </RowName>
                    )}
                    <RowMeta>{describeTrigger(a, snapshot.ut)}</RowMeta>
                    {a.onFire && a.onFire.length > 0 && (
                      <RowMeta>
                        <FireList>
                          {a.onFire.map((fx, i) => (
                            // biome-ignore lint/suspicious/noArrayIndexKey: action keys can repeat (operator may queue the same action twice); position is the only stable identity
                            <FireChip key={`${fx.action}-${i}`}>
                              <code>{fx.action}</code>
                              <FireRemoveButton
                                type="button"
                                aria-label={`Remove ${fx.action} from ${a.name}`}
                                onClick={() => {
                                  const next = (a.onFire ?? []).filter(
                                    (_, idx) => idx !== i,
                                  );
                                  onUpdate(a.id, { onFire: next });
                                }}
                              >
                                ×
                              </FireRemoveButton>
                            </FireChip>
                          ))}
                        </FireList>
                      </RowMeta>
                    )}
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

/**
 * A single quick-alarm preset: a label, the live value that determines
 * both visibility and the resulting UT, and how to derive the trigger UT.
 */
interface PresetSpec {
  id: string;
  label: string;
  /**
   * Compute the absolute trigger UT from the freshest snapshot UT, or
   * null when the underlying data isn't usable (off / on the pad / no
   * node). A null result hides the preset entirely.
   */
  computeUt: (utNow: number) => number | null;
}

/**
 * "Recommended" quick-time-alarm presets backed only by telemetry the app
 * already subscribes to (`o.timeToAp`, `o.timeToPe`, `o.maneuverNodes`).
 * Each preset appears only when its data is live and yields a future UT;
 * clicking it creates a notify-only time alarm via the same `onAdd` path
 * the manual form uses. It deliberately does NOT start a warp-to session —
 * the operator drives that from the banner's existing affordance.
 */
function RecommendedPresets({
  snapshotRef,
  onAdd,
}: {
  snapshotRef: React.MutableRefObject<AlarmSnapshot>;
  onAdd: AlarmsModalProps["onAdd"];
}) {
  // `o.timeToAp` / `o.timeToPe` are seconds-from-now; the maneuver node UT
  // is absolute. We read them live so a preset reflects the current orbit
  // at the moment of the click.
  const timeToAp = useDataValue<number>("data", "o.timeToAp");
  const timeToPe = useDataValue<number>("data", "o.timeToPe");
  const nodes = useManeuverNodes();
  const [open, setOpen] = useState(false);

  const utNow = snapshotRef.current.ut;
  // Soonest still-future maneuver node. A lingering past node is ignored so
  // the preset never schedules an alarm in the past.
  const nextNodeUt =
    utNow !== null
      ? (nodes
          .map((n) => n.UT)
          .filter((u) => Number.isFinite(u) && u > utNow)
          .sort((a, b) => a - b)[0] ?? null)
      : null;

  const presets: PresetSpec[] = [
    {
      id: "apoapsis",
      label: "Warp to apoapsis",
      computeUt: (now) =>
        typeof timeToAp === "number" &&
        Number.isFinite(timeToAp) &&
        timeToAp > 0
          ? now + timeToAp
          : null,
    },
    {
      id: "periapsis",
      label: "Warp to periapsis",
      computeUt: (now) =>
        typeof timeToPe === "number" &&
        Number.isFinite(timeToPe) &&
        timeToPe > 0
          ? now + timeToPe
          : null,
    },
    {
      id: "maneuver",
      label: "Warp to next maneuver",
      computeUt: () => nextNodeUt,
    },
  ];

  // Each preset must read a fresh UT at click time (snapshotRef), not the
  // render-time `utNow`, for the same stale-anchor reason as the manual
  // path. Visibility, however, can use the render-time `utNow` — the modal
  // re-renders every tick.
  const createPreset = (preset: PresetSpec) => {
    const liveUt = snapshotRef.current.ut;
    if (liveUt === null) return;
    const ut = preset.computeUt(liveUt);
    if (ut === null || !Number.isFinite(ut) || ut <= liveUt) return;
    onAdd({
      name: preset.label,
      trigger: { kind: "time", ut, leadSeconds: DEFAULT_LEAD_SECONDS },
    });
  };

  // Only presets whose data is live (and yield a future UT) are offered.
  // Pair each with its render-time UT so the button can show a T−countdown.
  const available =
    utNow === null
      ? []
      : presets.flatMap((p) => {
          const ut = p.computeUt(utNow);
          if (ut === null || !Number.isFinite(ut) || ut <= utNow) return [];
          return [{ preset: p, ut }];
        });

  if (available.length === 0) return null;

  return (
    <PresetSection>
      <PresetSummary
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <PresetCaret aria-hidden="true">{open ? "▾" : "▸"}</PresetCaret>
        Recommended ({available.length})
      </PresetSummary>
      {open && (
        <PresetList>
          {available.map(({ preset, ut }) => (
            <PresetButton
              key={preset.id}
              type="button"
              onClick={() => createPreset(preset)}
            >
              <PresetButtonLabel>{preset.label}</PresetButtonLabel>
              {utNow !== null && (
                <PresetButtonHint>
                  {formatUt(ut)} · T−{formatSeconds(ut - utNow)}
                </PresetButtonHint>
              )}
            </PresetButton>
          ))}
        </PresetList>
      )}
    </PresetSection>
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
  if (a.trigger.kind === "contract-parameter") {
    const t = a.trigger;
    const matchInfo =
      a.matchSinceUT != null && utNow != null
        ? ` · matched ${formatSeconds(utNow - a.matchSinceUT)} (need ${t.sustainSeconds}s)`
        : t.sustainSeconds > 0
          ? ` · sustain ${t.sustainSeconds}s`
          : "";
    return (
      <code>
        {t.parameterTitle} → {t.targetState}
        {matchInfo}
      </code>
    );
  }
  // Threshold — narrow exhausted by the two `kind` checks above.
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

interface OnFireEditorProps {
  value: AlarmFireAction[];
  onRemove: (idx: number) => void;
  pickerValue: string;
  onPickerChange: (next: string) => void;
  onAdd: () => void;
}

/**
 * Translate a gonogo ACTION_GROUPS toggle key (e.g. `f.ag1`, `f.sas`,
 * `f.brake`) into the matching KSPActionGroup enum name returned by
 * Telemachus's `f.ag.bindings` payload (`Custom01`, `SAS`, `Brakes`).
 * Returns null for toggle keys with no KSP equivalent.
 */
function kspActionGroupName(toggle: string | null): string | null {
  if (!toggle) return null;
  switch (toggle) {
    case "f.sas":
      return "SAS";
    case "f.rcs":
      return "RCS";
    case "f.light":
      return "Light";
    case "f.gear":
      return "Gear";
    // KSP plural — toggle key is singular for ergonomic reasons.
    case "f.brake":
      return "Brakes";
    case "f.abort":
      return "Abort";
    case "f.stage":
      return "Stage";
    default: {
      const m = toggle.match(/^f\.ag(\d+)$/);
      if (m) return `Custom${m[1].padStart(2, "0")}`;
      return null;
    }
  }
}

interface AgBinding {
  actionGroup: string;
  partName: string;
  partTitle: string;
  actionGuiName: string;
}

function isAgBindingArray(v: unknown): v is AgBinding[] {
  if (!Array.isArray(v)) return false;
  return v.every(
    (x) =>
      x &&
      typeof x === "object" &&
      typeof (x as AgBinding).actionGroup === "string",
  );
}

function captionForAg(
  toggle: string | null,
  bindings: AgBinding[] | null,
): string {
  if (!bindings) return "";
  const kspName = kspActionGroupName(toggle);
  if (!kspName) return "";
  const matches = bindings.filter((b) => b.actionGroup === kspName);
  if (matches.length === 0) return "";
  const first = matches[0].actionGuiName || matches[0].partTitle || "bound";
  if (matches.length === 1) return ` — ${first}`;
  return ` — ${first} +${matches.length - 1} more`;
}

function OnFireEditor({
  value,
  onRemove,
  pickerValue,
  onPickerChange,
  onAdd,
}: OnFireEditorProps) {
  // `f.ag.bindings` is vessel-scoped — returns nothing outside Flight.
  // That's fine: caption falls back to the plain "(f.ag1)" label.
  const bindingsRaw = useDataValue("data", "f.ag.bindings");
  const bindings = isAgBindingArray(bindingsRaw) ? bindingsRaw : null;

  return (
    <Field>
      <FieldLabel>When fires</FieldLabel>
      {value.length > 0 && (
        <FireList>
          {value.map((fx, i) => {
            const meta = FIRABLE_ACTIONS.find((g) => g.toggle === fx.action);
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: action keys can repeat; position is the only stable identity
              <FireChip key={`${fx.action}-${i}`}>
                <code>{fx.action}</code>
                {meta && <FireMeta>{meta.name}</FireMeta>}
                <FireRemoveButton
                  type="button"
                  aria-label={`Remove ${fx.action}`}
                  onClick={() => onRemove(i)}
                >
                  ×
                </FireRemoveButton>
              </FireChip>
            );
          })}
        </FireList>
      )}
      <PickerRow>
        <PickerSelect
          aria-label="Action group to fire"
          value={pickerValue}
          onChange={(e) => onPickerChange(e.target.value)}
        >
          {FIRABLE_ACTIONS.map((g) => (
            <option key={g.toggle} value={g.toggle}>
              {g.name} ({g.toggle}){captionForAg(g.toggle, bindings)}
            </option>
          ))}
        </PickerSelect>
        <GhostButton type="button" onClick={onAdd}>
          + Add action
        </GhostButton>
      </PickerRow>
      <FieldHint>
        Each attached action runs in order when the alarm fires. Leave empty for
        a notify-only alarm.
      </FieldHint>
    </Field>
  );
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
  color: var(--color-text-muted);
`;

const KindRow = styled.div`
  display: flex;
  gap: 4px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 4px;
  padding: 2px;
  background: var(--color-surface-sunken);
  width: fit-content;
`;

const KindButton = styled.button<{ $active: boolean }>`
  background: ${(p) => (p.$active ? "var(--color-status-go-bg)" : "transparent")};
  color: ${(p) => (p.$active ? "var(--color-status-go-fg)" : "var(--color-text-muted)")};
  border: none;
  padding: 4px 12px;
  border-radius: 3px;
  font-size: 11px;
  cursor: pointer;
  &:hover {
    color: var(--color-status-go-fg);
  }
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
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
  font-size: 12px;
  padding: 4px 6px;
  background: var(--color-surface-panel);
  color: var(--color-status-go-fg);
  border: 1px solid var(--color-border-subtle);
  border-radius: 3px;
`;

const WaitingNote = styled.div`
  color: var(--color-text-muted);
  font-size: 11px;
`;

const PresetSection = styled.section`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const PresetSummary = styled.button`
  display: flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: none;
  padding: 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  cursor: pointer;
  &:hover {
    color: var(--color-status-go-fg);
  }
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

const PresetCaret = styled.span`
  font-size: 10px;
  line-height: 1;
`;

const PresetList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const PresetButton = styled.button`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  text-align: left;
  padding: 8px 10px;
  background: var(--color-surface-panel);
  border: 1px solid var(--color-surface-raised);
  border-radius: 3px;
  cursor: pointer;
  &:hover {
    border-color: var(--color-status-go-bg);
  }
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

const PresetButtonLabel = styled.span`
  font-size: 13px;
  color: var(--color-status-go-fg);
`;

const PresetButtonHint = styled.span`
  font-size: 11px;
  color: var(--color-text-muted);
`;

const AddedNote = styled.div`
  color: var(--color-status-go-fg);
  font-size: 11px;
`;

const Empty = styled.div`
  color: var(--color-text-dim);
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
  background: var(--color-surface-panel);
  border: 1px solid
    ${(p) =>
      p.$state === "firing"
        ? "var(--color-status-nogo-bg)"
        : p.$state === "arming"
          ? "var(--color-status-warning-bg)"
          : "var(--color-surface-raised)"};
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
  font-size: 13px;
  color: var(--color-status-go-fg);
`;

const RowMeta = styled.div`
  font-size: 11px;
  color: var(--color-text-muted);
  code {
    color: var(--color-status-go-fg);
  }
`;

const StateTag = styled.span<{ $state: Alarm["state"] }>`
  text-transform: uppercase;
  font-size: var(--font-size-xs);
  letter-spacing: 0.08em;
  color: ${(p) =>
    p.$state === "firing"
      ? "var(--color-status-nogo-bg)"
      : p.$state === "arming"
        ? "var(--color-status-warning-bg)"
        : p.$state === "fired"
          ? "var(--color-text-dim)"
          : "var(--color-status-go-fg)"};
`;

const RowActions = styled.div`
  display: flex;
  gap: 4px;
  flex-shrink: 0;
`;

const DangerButton = styled.button`
  background: var(--color-status-alert-muted);
  color: var(--color-status-nogo-bg);
  border: 1px solid var(--color-status-alert-muted);
  padding: 3px 10px;
  border-radius: 3px;
  font-size: 11px;
  cursor: pointer;
  &:hover {
    background: var(--color-status-alert-muted);
  }
  &:focus-visible {
    outline: 2px solid var(--color-status-nogo-bg);
    outline-offset: 2px;
  }
`;

const FireList = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
`;

const FireChip = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 6px;
  background: var(--color-surface-sunken);
  border: 1px solid var(--color-border-subtle);
  border-radius: 3px;
  font-size: 11px;
  color: var(--color-text-muted);
  code {
    color: var(--color-status-go-fg);
  }
`;

const FireMeta = styled.span`
  color: var(--color-text-dim);
  font-size: 10px;
`;

const FireRemoveButton = styled.button`
  background: transparent;
  border: none;
  color: var(--color-text-dim);
  font-size: 14px;
  line-height: 1;
  padding: 0 2px;
  cursor: pointer;
  &:hover {
    color: var(--color-status-nogo-bg);
  }
  &:focus-visible {
    outline: 2px solid var(--color-status-nogo-bg);
    outline-offset: 1px;
  }
`;

const PickerRow = styled.div`
  display: flex;
  gap: 6px;
  align-items: stretch;
`;

const PickerSelect = styled.select`
  flex: 1;
  font-size: 12px;
  padding: 4px 6px;
  background: var(--color-surface-panel);
  color: var(--color-status-go-fg);
  border: 1px solid var(--color-border-subtle);
  border-radius: 3px;
`;
