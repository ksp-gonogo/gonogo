import {
  type ActionGroup,
  actionGroupIdOf,
  type TimeContexts,
  toggleCommandFor,
  useActionGroups,
  useTelemetry,
  useTimeContexts,
} from "@ksp-gonogo/core";
import {
  isThresholdSubject,
  useManeuverNodes,
  useTopicFieldCatalog,
} from "@ksp-gonogo/data";
import {
  useStream,
  type VesselState,
  wireAddressBehindRedirect,
} from "@ksp-gonogo/sitrep-client";
import {
  KSP_ACTION_GROUP_NAMES,
  KspActionGroup,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  DataKeyPicker,
  Field,
  FieldHint,
  FieldLabel,
  GhostButton,
  Input,
  PrimaryButton,
} from "@ksp-gonogo/ui";
import {
  Card,
  MissionDate,
  type ReadoutTone,
  SectionTitle,
  Stack,
  Unit,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import { useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import type {
  Alarm,
  AlarmFireAction,
  AlarmSnapshot,
  AlarmTrigger,
  AlarmVantage,
  ThresholdOp,
} from "./types";
import {
  DEFAULT_LEAD_SECONDS,
  DEFAULT_SUSTAIN_SECONDS,
  isScetTrigger,
} from "./types";

/**
 * Prefilled state for opening the modal in "create with hint" mode, the
 * ActionGroup widget's bell button uses this to drop the operator into a
 * draft that already has the action group attached, leaving them only the
 * trigger to fill in.
 */
export interface AlarmDraftPrefill {
  name?: string;
  onFire?: AlarmFireAction[];
}

/**
 * Pickable groups for `onFire`. Filters out the ones that fire nothing (Precision
 * Control is a read-only indicator), since offering them would be a no-op the
 * operator could not tell from a working choice.
 *
 * The filter asks whether the group has a COMMAND, because a command is the
 * thing that has to exist for the pick to do anything.
 *
 * A HOOK rather than a module-scope constant: the action-group registry derives
 * its custom half from live telemetry (`useActionGroups`), so the list cannot
 * be computed at module load. Under a future AGX backend this is what makes the
 * player's own named groups appear in the alarm picker for free.
 */
function useFirableActions(): ActionGroup[] {
  const groups = useActionGroups();
  return useMemo(
    () => groups.filter((g) => toggleCommandFor(g) !== null),
    [groups],
  );
}

/**
 * CRUD UI for the alarm list. Intentionally screen-agnostic, accepts a
 * snapshot + command callbacks so both main and station mount the same
 * component from different service backends.
 *
 * v2: supports both time and threshold triggers via a kind selector.
 */

export interface AlarmsModalProps {
  /**
   * Read the latest snapshot. The modal calls this every render so it
   * stays in sync with live UT: captured snapshot props go stale once
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
  // Which clock the instants in this modal are on. Undefined qualifiers on a
  // LAN session, where there is only one clock to be on.
  const timeContexts = useTimeContexts();
  /* Value-restricted keys: a threshold compares against a scalar Value (per the
     Uplink Domain/Topic/Value/Stream/Asset vocab), so this hides enums,
     booleans, opaque structs, untyped raws, AND any legacy key with no stream
     home (the alarm's `readTelemetryNumber` reads off the stream: see
     `AlarmStateMachine`).

     The catalogue rather than `useValueKeys`, which is the same list with the
     same filter and hands back the narrower `DataKeyMeta`. A SCET threshold is
     armed on a Topic and a path into its payload, and these entries carry both;
     `useValueKeys` would leave this side splitting a flat key back apart, which
     is a guess (`vessel.orbit.truth` has three segments and `vessel.flight` has
     two). No second table: the address comes from the same contract metadata
     the key itself was enumerated from. */
  const catalog = useTopicFieldCatalog();
  const numericKeys = useMemo(
    () => catalog.filter(isThresholdSubject),
    [catalog],
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
  const kindRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [name, setName] = useState(prefill?.name ?? "");
  // Time-trigger fields
  const [offsetSeconds, setOffsetSeconds] = useState("60");
  const [leadSeconds, setLeadSeconds] = useState(String(DEFAULT_LEAD_SECONDS));
  /**
   * Which clock the new alarm's instant is on. Defaults to the command vantage,
   * so nothing changes for an operator who never touches the control, and the
   * control itself is hidden below the visible gap (see `vantageChoiceVisible`).
   */
  const [vantage, setVantage] = useState<AlarmVantage>("command");
  // Threshold-trigger fields
  const [dataKey, setDataKey] = useState("vessel.state.altitudeAsl");
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
  const firableActions = useFirableActions();
  // Seeded lazily from the registry's first entry. The registry's custom half
  // arrives with telemetry, but the STOCK half (SAS first) is present from the
  // first render, so this is never empty in practice, the `?? ""` is belt and
  // braces, matching the previous module-scope behaviour.
  const [pickerAction, setPickerAction] = useState<string>(
    firableActions[0] ? actionGroupIdOf(firableActions[0]) : "",
  );

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  /**
   * Whether to offer the choice at all.
   *
   * `useTimeContexts` drops both qualifiers when the two clocks are under a
   * second apart, on the reasoning that a label nobody can check teaches
   * nothing. That applies with more force to a control whose two options would
   * then be the same alarm: a visible-but-inert radio teaches an operator that
   * the distinction is decorative, which is exactly the wrong lesson about the
   * one thing this whole feature is for.
   */
  const vantageChoiceVisible = timeContexts.scet !== undefined;
  const effectiveVantage: AlarmVantage = vantageChoiceVisible
    ? vantage
    : "command";

  const offsetN = Number.parseFloat(offsetSeconds);
  const valueN = Number.parseFloat(thresholdValue);
  const trimmedName = name.trim();
  const trimmedKey = dataKey.trim();
  const selectedKey = useMemo(
    () => numericKeys.find((k) => k.key === trimmedKey) ?? null,
    [numericKeys, trimmedKey],
  );
  /**
   * The address the simulation would be given for the chosen field: a Topic it
   * publishes and a path into that payload. Null when there is none.
   *
   * Two resolutions, in this order.
   *
   * The picker shows a handful of kinematics under `vessel.state.*`, a channel
   * this client COMPUTES, because binding widgets to two names for one altitude
   * is the wart that redirect exists to kill. The simulation has never heard of
   * that channel, so an arm naming it could not be read, and the case lost
   * would be the altitude threshold the whole feature was asked for.
   * `wireAddressBehindRedirect` hands back the wire name the redirect pointed
   * away from, derived from the redirect table itself.
   *
   * Otherwise the catalogue entry's own Topic and path, which every entry
   * enumerated from the contract carries. A key a live `DataSource` supplied
   * from its own `schema()` has neither, and nothing can be resolved for it.
   * Checked at PRESS rather than by hiding the row, so the operator still sees
   * a key they can read on a graph and learns only that this ARM cannot use
   * it.
   */
  const scetAddress = useMemo(() => {
    if (selectedKey === null) return null;
    const wire = wireAddressBehindRedirect(selectedKey.key);
    if (wire !== null) return wire;
    if (selectedKey.topic === "" || selectedKey.fieldPath === "") return null;
    return { topic: selectedKey.topic, fieldPath: selectedKey.fieldPath };
  }, [selectedKey]);
  const scetAddressable = scetAddress !== null;
  const addDisabled =
    trimmedName === "" ||
    (kind === "time" &&
      (!Number.isFinite(offsetN) || offsetN <= 0 || snapshot.ut === null)) ||
    (kind === "threshold" &&
      (trimmedKey === "" ||
        !Number.isFinite(valueN) ||
        (effectiveVantage === "scet" && !scetAddressable)));

  const handleAdd = () => {
    if (addDisabled) return;
    let trigger: AlarmTrigger;
    if (kind === "time") {
      // Read UT live from the ref; using the destructured `snapshot`
      // could anchor the trigger to a stale UT if the user adds two alarms
      // in quick succession (the modal re-renders on snapshot updates,
      // but a click handler closes over its render-time snapshot).
      const liveUt = snapshotRef.current.ut ?? 0;
      /* "In n seconds" is n seconds of the OPERATOR's waiting either way. For a
         command-vantage alarm that is n seconds on the view clock they are
         reading; for a SCET one the instant has to be stated on the craft's
         clock, which is a light-time ahead of it, or "in 60 seconds" would mean
         an alarm that already passed. */
      const ut =
        effectiveVantage === "scet"
          ? liveUt + timeContexts.owltSeconds + offsetN
          : liveUt + offsetN;
      const lead = Number.parseFloat(leadSeconds);
      trigger = {
        kind: "time",
        ut,
        leadSeconds:
          Number.isFinite(lead) && lead > 0 ? lead : DEFAULT_LEAD_SECONDS,
        vantage: effectiveVantage,
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
        vantage: effectiveVantage,
        /* The Topic and the path, carried only on the arm that needs them.
           `addDisabled` has already refused a SCET threshold without an
           address, so this is never the half-filled case. */
        ...(effectiveVantage === "scet" && scetAddress !== null
          ? scetAddress
          : {}),
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
    // Allow duplicates: operators sometimes intentionally fire the same
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
      <Stack as="section" gap="md">
        <SectionTitle as="h3">Add alarm</SectionTitle>
        <KindRow role="radiogroup" aria-label="Trigger kind">
          {KIND_OPTIONS.map((option, index) => (
            <KindButton
              key={option.kind}
              ref={(el) => {
                kindRefs.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={kind === option.kind}
              // Roving tabindex: a chosen-one-of-many control offers the tab
              // order its selection, and the arrow keys the rest.
              tabIndex={kind === option.kind ? 0 : -1}
              $active={kind === option.kind}
              onClick={() => setKind(option.kind)}
              onKeyDown={(e) => {
                const step =
                  e.key === "ArrowRight" || e.key === "ArrowDown"
                    ? 1
                    : e.key === "ArrowLeft" || e.key === "ArrowUp"
                      ? -1
                      : 0;
                if (step === 0) return;
                e.preventDefault();
                const next =
                  (index + step + KIND_OPTIONS.length) % KIND_OPTIONS.length;
                setKind(KIND_OPTIONS[next].kind);
                kindRefs.current[next]?.focus();
              }}
            >
              {option.label}
            </KindButton>
          ))}
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

        {/* Both arms, not just the time one: a threshold on the craft's clock
            is the case that genuinely cannot be evaluated here at all. */}
        {vantageChoiceVisible && (
          <Field>
            <FieldLabel as="span" id="alarm-vantage-label">
              Fires on
            </FieldLabel>
            <KindRow role="radiogroup" aria-labelledby="alarm-vantage-label">
              {VANTAGE_OPTIONS.map((option) => (
                <KindButton
                  key={option.vantage}
                  type="button"
                  role="radio"
                  aria-checked={vantage === option.vantage}
                  tabIndex={vantage === option.vantage ? 0 : -1}
                  $active={vantage === option.vantage}
                  onClick={() => setVantage(option.vantage)}
                  onKeyDown={(e) => {
                    const step =
                      e.key === "ArrowRight" || e.key === "ArrowDown"
                        ? 1
                        : e.key === "ArrowLeft" || e.key === "ArrowUp"
                          ? -1
                          : 0;
                    if (step === 0) return;
                    e.preventDefault();
                    const index = VANTAGE_OPTIONS.findIndex(
                      (o) => o.vantage === vantage,
                    );
                    const next =
                      (index + step + VANTAGE_OPTIONS.length) %
                      VANTAGE_OPTIONS.length;
                    setVantage(VANTAGE_OPTIONS[next].vantage);
                  }}
                >
                  {option.label}
                </KindButton>
              ))}
            </KindRow>
            <FieldHint>
              {effectiveVantage === "scet"
                ? "Armed on the craft's clock. The mod stops the warp for everybody when it comes due, and your readings stay a light-time behind."
                : "Armed on the clock you are reading. The craft passed the moment one light-time earlier."}
            </FieldHint>
          </Field>
        )}

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
                  {/* An offset from the view clock lands on the view clock, so
                      a command-vantage alarm is an arrival time and says so:
                      the operator asked for "n seconds from now", and their now
                      is the delayed one they are reading. A SCET alarm is the
                      same interval stated on the craft's clock, which is where
                      it will be evaluated. */}
                  <MissionDate
                    value={
                      snapshot.ut +
                      (effectiveVantage === "scet"
                        ? timeContexts.owltSeconds
                        : 0) +
                      Number.parseFloat(offsetSeconds || "0")
                    }
                    context={
                      effectiveVantage === "scet"
                        ? timeContexts.scet
                        : timeContexts.received
                    }
                  />
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
                subjectNoun="alarm subject"
                keys={numericKeys}
                value={dataKey || null}
                onChange={(k) => setDataKey(k ?? "")}
                placeholder="Search telemetry..."
                clearable
              />
              <FieldHint>
                Any telemetry key that returns a number, e.g.{" "}
                <code>vessel.flight.altitudeAsl</code>,{" "}
                <code>vessel.flight.verticalSpeed</code>.
              </FieldHint>
              {effectiveVantage === "scet" &&
                trimmedKey !== "" &&
                !scetAddressable && (
                  <FieldHint>
                    <code>{trimmedKey}</code> has no Topic behind it, so there
                    is no address the simulation could read it from.
                  </FieldHint>
                )}
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
            Waiting for a universal-time reading before new alarms can be
            scheduled.
          </WaitingNote>
        )}
      </Stack>

      <RecommendedPresets snapshotRef={snapshotRef} onAdd={onAdd} />

      <Stack as="section" gap="md">
        <SectionTitle as="h3">Scheduled ({sorted.length})</SectionTitle>
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
                <AlarmListItem key={a.id} tone={ALARM_TONE[a.state]}>
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
                      <AlarmListName>
                        <Badge size="md">
                          {a.trigger.kind === "time" ? "TIME" : "COND"}
                        </Badge>
                        {/* Only the threshold arm. A SCET time row already
                            states its clock, because `describeTrigger` renders
                            its instant with the SCET qualifier; a threshold has
                            no instant to qualify until it fires, so without
                            this the row would not say which clock decides it. */}
                        {a.trigger.kind === "threshold" &&
                          isScetTrigger(a.trigger) && (
                            <Badge severity="info" size="sm">
                              SCET
                            </Badge>
                          )}
                        {a.name}
                        {a.onFire && a.onFire.length > 0 && (
                          <Badge severity="info" size="sm">
                            {a.onFire.length === 1
                              ? "FIRES 1 ACTION"
                              : `FIRES ${a.onFire.length} ACTIONS`}
                          </Badge>
                        )}
                      </AlarmListName>
                    )}
                    <RowMeta>
                      {describeTrigger(a, snapshot.ut, timeContexts)}
                    </RowMeta>
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
                    {/* The simulation would not take this arm, in its own
                        words. Without it the row reads `pending` forever and
                        nothing tells the difference between an alarm waiting
                        and an alarm that was never accepted. */}
                    {snapshot.scetArmRefusals?.[a.id] !== undefined && (
                      <RowMeta role="status">
                        <Badge severity="warning" size="sm">
                          NOT ARMED
                        </Badge>{" "}
                        {snapshot.scetArmRefusals[a.id]}
                      </RowMeta>
                    )}
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
                </AlarmListItem>
              );
            })}
          </List>
        )}
      </Stack>
    </Wrap>
  );
}

/**
 * A single quick-alarm preset: a label, the live value that determines
 * both visibility and the resulting SCET, and how to derive it.
 */
interface PresetSpec {
  id: string;
  /** What the button says. */
  label: string;
  /** What the alarm it creates is called. */
  alarmName: string;
  /**
   * Compute the SCET of the event from the freshest view UT, or null when the
   * underlying data isn't usable (off / on the pad / no node). A null result
   * hides the preset entirely.
   *
   * SCET rather than a trigger UT, because those are two different instants
   * once the craft is more than a second away. See `presetTriggerUt`.
   */
  computeScet: (viewUt: number) => number | null;
}

/**
 * The view-clock instant an alarm must hold to fire AT the event, from the
 * event's SCET.
 *
 * The alarm pipeline ticks on the view clock (`AlarmHostService` reads
 * `getViewUt`), which runs one light-time behind the craft. So an alarm
 * holding a SCET fires one light-time AFTER the thing happened: a "warp to
 * apoapsis" alarm at Duna went off four to twenty minutes past apoapsis, and
 * nothing in the UI or the type system noticed. Subtracting the light-time
 * puts the alarm where the operator asked for it, at the cost of firing
 * BEFORE they can see the event, which is the whole point of a warp target:
 * you want to arrive with the event still ahead of you.
 *
 * At `owlt` 0 this is the identity, so a LAN session is untouched.
 */
function presetTriggerUt(scetUt: number, owltSeconds: number): number {
  return scetUt - owltSeconds;
}

/**
 * Quick-alarm presets backed only by telemetry the app already subscribes to
 * (`vessel.state.timeToAp` / `timeToPe`, `vessel.maneuver`). Each preset
 * appears only when its data is live and still yields a future trigger;
 * clicking it creates a notify-only time alarm via the same `onAdd` path the
 * manual form uses.
 *
 * They are labelled "Alarm at ...", which is what they do. They said "Warp
 * to ..." for a year while deliberately not starting a warp-to session (the
 * operator drives that from the banner's existing affordance), and a button
 * that names an action it does not take is worth fixing on its own terms.
 *
 * Every instant here is a SCET: an apsis time is `timeToAp` added to the UT of
 * the frame that reported it, and a maneuver node's UT is a plan held on the
 * craft. Both are stated as SCET on screen and converted once, at the trigger.
 */
function RecommendedPresets({
  snapshotRef,
  onAdd,
}: {
  snapshotRef: React.MutableRefObject<AlarmSnapshot>;
  onAdd: AlarmsModalProps["onAdd"];
}) {
  // `timeToAp` / `timeToPe` are seconds-from-now; the maneuver node UT
  // is absolute. We read them live so a preset reflects the current orbit
  // at the moment of the click. Both are derived `vessel.state.*` fields,
  // read off the canonical stream.
  const vesselState = useStream<VesselState>("vessel.state");
  const timeToAp = vesselState?.timeToAp ?? undefined;
  const timeToPe = vesselState?.timeToPe ?? undefined;
  const nodes = useManeuverNodes();
  const { owltSeconds, scet } = useTimeContexts();
  const [open, setOpen] = useState(false);

  const utNow = snapshotRef.current.ut;
  /*
   * Soonest maneuver node still ahead of the CRAFT. The bound is one
   * light-time past the view clock because that is where the craft is now: a
   * node inside that window is already behind it, and offering an alarm for
   * one would schedule a trigger in the past. A lingering node already flown
   * is ignored the same way.
   */
  const nextNodeScet =
    utNow !== null
      ? (nodes
          .map((n) => n.UT)
          .filter((u) => Number.isFinite(u) && u > utNow + owltSeconds)
          .sort((a, b) => a - b)[0] ?? null)
      : null;

  const presets: PresetSpec[] = [
    {
      id: "apoapsis",
      label: "Alarm at apoapsis",
      alarmName: "Apoapsis",
      computeScet: (viewUt) =>
        typeof timeToAp === "number" &&
        Number.isFinite(timeToAp) &&
        timeToAp > 0
          ? viewUt + timeToAp
          : null,
    },
    {
      id: "periapsis",
      label: "Alarm at periapsis",
      alarmName: "Periapsis",
      computeScet: (viewUt) =>
        typeof timeToPe === "number" &&
        Number.isFinite(timeToPe) &&
        timeToPe > 0
          ? viewUt + timeToPe
          : null,
    },
    {
      id: "maneuver",
      label: "Alarm at next maneuver",
      alarmName: "Next maneuver",
      computeScet: () => nextNodeScet,
    },
  ];

  // Each preset must read a fresh UT at click time (snapshotRef), not the
  // render-time `utNow`, for the same stale-anchor reason as the manual
  // path. Visibility, however, can use the render-time `utNow`, the modal
  // re-renders every tick.
  const createPreset = (preset: PresetSpec) => {
    const liveUt = snapshotRef.current.ut;
    if (liveUt === null) return;
    const scetUt = preset.computeScet(liveUt);
    if (scetUt === null || !Number.isFinite(scetUt)) return;
    const ut = presetTriggerUt(scetUt, owltSeconds);
    if (ut <= liveUt) return;
    onAdd({
      name: preset.alarmName,
      trigger: { kind: "time", ut, leadSeconds: DEFAULT_LEAD_SECONDS },
    });
  };

  /*
   * Only presets whose data is live and whose trigger is still ahead of the
   * view clock are offered. Under delay that gate is stricter than it looks: a
   * craft four minutes away that is three minutes from apoapsis has already
   * passed it, and there is no honest alarm left to offer for that pass.
   *
   * Each is paired with its SCET so the button can show WHEN, and the
   * countdown is taken from the trigger so it says how long until the alarm.
   * The two are the same number, because the trigger lags the SCET by exactly
   * the light-time the view clock does.
   */
  const available =
    utNow === null
      ? []
      : presets.flatMap((p) => {
          const scetUt = p.computeScet(utNow);
          if (scetUt === null || !Number.isFinite(scetUt)) return [];
          const ut = presetTriggerUt(scetUt, owltSeconds);
          if (ut <= utNow) return [];
          return [{ preset: p, scetUt, ut }];
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
          {available.map(({ preset, scetUt, ut }) => (
            <PresetButton
              key={preset.id}
              type="button"
              onClick={() => createPreset(preset)}
            >
              <PresetButtonLabel>{preset.label}</PresetButtonLabel>
              {utNow !== null && (
                <PresetButtonHint>
                  <MissionDate value={scetUt} context={scet} /> · T−
                  <Unit value={value("s", ut - utNow)} />
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

/**
 * The one-line trigger summary under an alarm's name.
 *
 * `contexts` says which clock each instant here belongs to, and the two
 * genuinely differ within one row: an alarm's own UT is a view-clock instant
 * (the pipeline ticks on the view clock, so that is when the operator will be
 * told), while an event alarm's `eventUT` is the occurrence's own SCET, which
 * under delay is long before. Labelling them lets the row carry both without
 * the reader having to know which is which.
 */
function describeTrigger(
  a: Alarm,
  utNow: number | null,
  contexts: TimeContexts,
): React.ReactNode {
  if (a.trigger.kind === "time") {
    const scet = a.trigger.vantage === "scet";
    /* A SCET instant is on the craft's clock and `utNow` is on the view clock,
       so the countdown has to cross the gap between them or it reads a whole
       light-time long. The qualifier beside it says which clock the INSTANT is
       on; this is the same fact applied to the interval. */
    const triggerOnViewClock = scet
      ? a.trigger.ut - contexts.owltSeconds
      : a.trigger.ut;
    const delta = utNow !== null ? triggerOnViewClock - utNow : null;
    return (
      <>
        <MissionDate
          value={a.trigger.ut}
          context={scet ? contexts.scet : contexts.received}
        />
        {delta !== null && (
          <>
            {" · "}
            {delta >= 0 ? "T−" : "T+"}
            <Unit value={value("s", Math.abs(delta))} />
          </>
        )}
        {" · lead "}
        <Unit value={value("s", a.trigger.leadSeconds)} />
      </>
    );
  }
  if (a.trigger.kind === "contract-parameter") {
    const t = a.trigger;
    const matchInfo =
      a.matchSinceUT != null && utNow != null
        ? ` · matched ${writeQuantity(value("s", utNow - a.matchSinceUT))} (need ${writeQuantity(value("s", t.sustainSeconds))})`
        : t.sustainSeconds > 0
          ? ` · sustain ${writeQuantity(value("s", t.sustainSeconds))}`
          : "";
    return (
      <code>
        {t.parameterTitle} → {t.targetState}
        {matchInfo}
      </code>
    );
  }
  if (a.trigger.kind === "event") {
    const t = a.trigger;
    return (
      <>
        <code>
          {t.topic}
          {t.eventKind != null && ` · ${t.eventKind}`}
        </code>
        {/* When it HAPPENED, not when it reached us: under delay the row
            otherwise said only that something had, and never when. */}
        {a.eventUT != null && (
          <>
            {" · "}
            <MissionDate value={a.eventUT} context={contexts.scet} />
          </>
        )}
      </>
    );
  }
  // Threshold: narrow exhausted by the three `kind` checks above.
  const t = a.trigger;
  const scet = t.vantage === "scet";
  /* A SCET arm reports the window it is waiting for, never progress through it.
     The mod measures the sustain against the craft's own ticks, and
     `matchSinceUT` on this side is the REVEAL of the fire notice rather than
     the moment the condition began holding: rendering it as "matched 3s" would
     be inventing a progress bar for a window this client never watched. */
  const matchInfo =
    !scet && a.matchSinceUT != null && utNow != null
      ? ` · matched ${writeQuantity(value("s", utNow - a.matchSinceUT))} (need ${writeQuantity(value("s", t.sustainSeconds))})`
      : t.sustainSeconds > 0
        ? ` · sustain ${writeQuantity(value("s", t.sustainSeconds))}`
        : "";
  return (
    <>
      <code>
        {t.dataKey} {t.op} {t.value}
        {matchInfo}
      </code>
      {/* When the craft crossed it, on the craft's clock: the same instant an
          event alarm reports, and the only number a fired SCET row can give. */}
      {scet && a.eventUT != null && (
        <>
          {" · "}
          <MissionDate value={a.eventUT} context={contexts.scet} />
        </>
      )}
    </>
  );
}

// `formatUt` is gone: it was a hand-rolled `Y# D# HH:MM:SS` that duplicated
// <MissionDate>, divided by a hardcoded 21,600 (wrong under a planet pack or
// with the stock KERBIN_TIME setting off), and printed a literal "Y1" for
// every date, so a game in its third year still read as year one. All three
// call sites render it as a node, so the component drops straight in.

interface OnFireEditorProps {
  value: AlarmFireAction[];
  onRemove: (idx: number) => void;
  pickerValue: string;
  onPickerChange: (next: string) => void;
  onAdd: () => void;
}

/**
 * Translate one action group into the matching KSPActionGroup enum bit carried
 * in the parts tree's `actionBindings[].groups` (`Custom01`, `SAS`, `Brakes`).
 * Returns null for a group with no KSP equivalent.
 *
 * Keyed off the GROUP rather than off a name for it. A custom answers by its
 * own index, which is what KSP numbers them by, and a stock singleton by its
 * name: the same split `actionGroupIdOf` makes, for the same reason.
 */
function kspActionGroupBit(group: ActionGroup | null): number | null {
  if (!group) return null;
  if (group.index !== undefined) {
    // Looked up in the derived value-to-name table rather than against a
    // Custom01..Custom10 list, so a custom group KSP adds resolves here with
    // the next codegen and needs no edit.
    const name = `Custom${String(group.index).padStart(2, "0")}`;
    for (const [bit, memberName] of KSP_ACTION_GROUP_NAMES) {
      if (memberName === name) return bit;
    }
    return null;
  }
  switch (group.name) {
    case "SAS":
      return KspActionGroup.SAS;
    case "RCS":
      return KspActionGroup.RCS;
    case "Light":
      return KspActionGroup.Light;
    case "Gear":
      return KspActionGroup.Gear;
    // KSP spells it plural; the group is singular for ergonomic reasons.
    case "Brake":
      return KspActionGroup.Brakes;
    case "Abort":
      return KspActionGroup.Abort;
    case "Stage":
      return KspActionGroup.Stage;
    default:
      return null;
  }
}

interface AgBinding {
  /** The action's whole `KSPActionGroup` bitmask, what the caption matches on. */
  groupsMask: number;
  partName: string;
  partTitle: string;
  actionGuiName: string;
}

/**
 * Action-group bindings for the caption, derived from the parts tree
 * (`vessel.parts` → each part's `actionBindings`). Replaces the retired
 * `f.ag.bindings` shim: flattens the per-part `{ action, groups[] }` contract
 * into the caption's per-(group, action) {@link AgBinding} shape. `null` until
 * the parts tree arrives (vessel-scoped: empty outside Flight), so the caption
 * falls back to the plain "(f.ag1)" label.
 */
function useActionGroupBindings(): AgBinding[] | null {
  const partsReading = useTelemetry("vessel.parts");
  // FAIL-OPEN FIX, not merely a migration. This was `if (!parts?.parts)` on a
  // bare payload; a `Reading` is an object and always truthy, so the guard
  // stopped guarding and the loop below ran against a payload it had not
  // checked for. An alarm surface is the worst place for a gate that renders
  // more than it should.
  //
  // Action-group BINDINGS are structure, not a quantity: they change when a
  // craft is built or docked, so a stale set is still the set, and a label is
  // better than a bare "(f.ag1)" fallback even on an old frame.
  const parts =
    partsReading.state === "observed" || partsReading.state === "stale"
      ? partsReading.value
      : undefined;
  return useMemo(() => {
    if (!parts?.parts) return null;
    const out: AgBinding[] = [];
    for (const part of parts.parts) {
      for (const binding of part.actionBindings ?? []) {
        // One entry per ACTION, not per (action, group) pair: the mask already
        // carries every group the action fires with. Flattening it into a name
        // list on the mod side would mean intersecting the mask against the
        // groups that capture knows about, so a group KSP added would be
        // dropped before the wire.
        out.push({
          groupsMask: binding.groupsMask ?? 0,
          partName: part.name,
          partTitle: part.title,
          actionGuiName: binding.action,
        });
      }
    }
    return out;
  }, [parts]);
}

function captionForAg(
  group: ActionGroup | null,
  bindings: AgBinding[] | null,
): string {
  if (!bindings) return "";
  const bit = kspActionGroupBit(group);
  if (bit === null) return "";
  const matches = bindings.filter((b) => (b.groupsMask & bit) === bit);
  if (matches.length === 0) return "";
  const first = matches[0].actionGuiName || matches[0].partTitle || "bound";
  if (matches.length === 1) return `: ${first}`;
  return `: ${first} +${matches.length - 1} more`;
}

function OnFireEditor({
  value,
  onRemove,
  pickerValue,
  onPickerChange,
  onAdd,
}: OnFireEditorProps) {
  // Action-group captions now derive from the parts tree (vessel.parts →
  // actionBindings), not the retired `f.ag.bindings` shim. Vessel-scoped, so
  // null outside Flight: the caption falls back to the plain "(f.ag1)" label.
  const bindings = useActionGroupBindings();
  const firableActions = useFirableActions();

  return (
    <Field>
      <FieldLabel>When fires</FieldLabel>
      {value.length > 0 && (
        <FireList>
          {value.map((fx, i) => {
            const meta = firableActions.find(
              (g) => actionGroupIdOf(g) === fx.action,
            );
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
          {firableActions.map((g) => (
            <option key={actionGroupIdOf(g)} value={actionGroupIdOf(g)}>
              {g.name} ({actionGroupIdOf(g)}){captionForAg(g, bindings)}
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
  gap: var(--gap-section);
  min-width: 480px;
  max-width: 640px;
`;

/**
 * The two trigger kinds, in the order they are offered. Ordered rather than
 * mapped because the arrow keys step through this list.
 */
const KIND_OPTIONS: readonly { kind: DraftKind; label: string }[] = [
  { kind: "time", label: "At UT" },
  { kind: "threshold", label: "When telemetry..." },
];

/**
 * The two clocks a time alarm can be set against, in the vocabulary the rest of
 * the app already uses for them: `<MissionDate>` prints `SCET` for the craft's
 * own clock and `AT <vantage>` for the arrival clock, so these labels are the
 * badges the operator will see on the resulting row.
 */
const VANTAGE_OPTIONS: readonly { vantage: AlarmVantage; label: string }[] = [
  { vantage: "command", label: "Received" },
  { vantage: "scet", label: "SCET" },
];

const KindRow = styled.div`
  display: flex;
  gap: var(--gap-related);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  padding: var(--space-2);
  background: var(--color-surface-sunken);
  width: fit-content;
`;

const KindButton = styled.button<{ $active: boolean }>`
  background: ${(p) => (p.$active ? "var(--color-status-go-bg)" : "transparent")};
  color: ${(p) => (p.$active ? "var(--color-status-go-fg)" : "var(--color-text-muted)")};
  border: none;
  padding: var(--inset-control);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
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
  gap: var(--gap-section);
  & > * {
    flex: 1;
  }
`;

const OpSelect = styled.select`
  font-size: var(--font-size-sm);
  padding: var(--inset-control);
  background: var(--color-surface-panel);
  color: var(--color-status-go-fg);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
`;

const WaitingNote = styled.div`
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
`;

const PresetSection = styled.section`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

const PresetSummary = styled.button`
  display: flex;
  align-items: center;
  gap: var(--gap-related);
  background: transparent;
  border: none;
  padding: 0;
  font-size: var(--font-size-xs);
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
  font-size: var(--font-size-2xs);
  line-height: var(--line-height-flush);
`;

const PresetList = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

const PresetButton = styled.button`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--gap-related);
  text-align: left;
  padding: var(--inset-control);
  background: var(--color-surface-panel);
  border: 1px solid var(--color-surface-raised);
  border-radius: var(--radius-sm);
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
  font-size: var(--font-size-sm);
  color: var(--color-status-go-fg);
`;

const PresetButtonHint = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
`;

const AddedNote = styled.div`
  color: var(--color-status-go-fg);
  font-size: var(--font-size-xs);
`;

const Empty = styled.div`
  color: var(--color-text-dim);
  font-size: var(--font-size-sm);
  padding: var(--space-12) 0;
`;

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

/** Alarm states, mapped onto the kit's tone vocabulary. */
const ALARM_TONE: Record<Alarm["state"], ReadoutTone> = {
  firing: "alert",
  arming: "warning",
  pending: "default",
  fired: "default",
};

// A tone-accented card, same family as PerfBudgets. It draws a full
// state-coloured border where the kit draws a leading accent rule, which is
// the deliberate delta.
const AlarmListItem = styled(Card).attrs({ as: "li" as const })`
  display: flex;
  align-items: center;
  /* Section, not related: the info column, the state tag and the buttons are
     three different kinds of thing. Inside a card that resolves to the 12 this
     used to spell. The inset is Card's own, so it is not restated here. */
  gap: var(--gap-section);
`;

const RowInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  flex: 1;
  min-width: 0;
`;

const AlarmListName = styled.div`
  display: flex;
  align-items: center;
  gap: var(--gap-related);
  font-size: var(--font-size-sm);
  color: var(--color-status-go-fg);
`;

const RowMeta = styled.div`
  font-size: var(--font-size-xs);
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
  gap: var(--gap-related);
  flex-shrink: 0;
`;

const DangerButton = styled.button`
  background: var(--color-status-alert-muted);
  color: var(--color-status-nogo-bg);
  border: 1px solid var(--color-status-alert-muted);
  padding: var(--inset-control);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
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
  gap: var(--gap-related);
`;

const FireChip = styled.span`
  display: inline-flex;
  align-items: center;
  gap: var(--gap-related);
  padding: var(--inset-chip);
  background: var(--color-surface-sunken);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  code {
    color: var(--color-status-go-fg);
  }
`;

const FireMeta = styled.span`
  color: var(--color-text-dim);
  font-size: var(--font-size-2xs);
`;

const FireRemoveButton = styled.button`
  background: transparent;
  border: none;
  color: var(--color-text-dim);
  font-size: var(--font-size-base);
  line-height: var(--line-height-flush);
  padding: 0 var(--space-2);
  cursor: pointer;
  &:hover {
    color: var(--color-status-nogo-bg);
  }
  &:focus-visible {
    /* 1px, not the 2px house value, and off the spacing ladder either way:
       this is WCAG indicator geometry, not an inconsistency to normalise. */
    outline: 2px solid var(--color-status-nogo-bg);
    outline-offset: 1px;
  }
`;

const PickerRow = styled.div`
  display: flex;
  gap: var(--gap-related);
  align-items: stretch;
`;

const PickerSelect = styled.select`
  flex: 1;
  font-size: var(--font-size-sm);
  padding: var(--inset-control);
  background: var(--color-surface-panel);
  color: var(--color-status-go-fg);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
`;
