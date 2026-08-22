import type {
  ActionDefinition,
  ActionGroup,
  ActionGroupId,
  ComponentProps,
  ConfigComponentProps,
} from "@ksp-gonogo/core";
import {
  AugmentSlot,
  actionGroupIdOf,
  getSizeBucket,
  registerComponent,
  useActionGroupFrom,
  useActionGroups,
  useActionInput,
  useTelemetry,
} from "@ksp-gonogo/core";
import { type Reading, useCommand } from "@ksp-gonogo/sitrep-client";
import type { VesselControl, VesselStructure } from "@ksp-gonogo/sitrep-sdk";
import {
  BellIcon,
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  Input,
  Panel,
  Placeholder,
  Select,
  ToggleButton,
  useModalSaveBar,
} from "@ksp-gonogo/ui";
import {
  Badge,
  Cluster,
  IconButton,
  Inline,
  NULL_DISPLAY,
  Stack,
  Text,
  Truncate,
  usePanelDelay,
} from "@ksp-gonogo/ui-kit";
import { useMemo, useRef, useState } from "react";
import { useAlarmsLauncher } from "../shared/AlarmsLauncher";

type ActionGroupConfig = {
  actionGroupId: ActionGroupId;
  /** Custom display label. Falls back to the official action group name. */
  label?: string;
};

const actionGroupActions = [
  {
    id: "toggle",
    label: "Toggle",
    accepts: ["button"],
    description: "Toggles this action group on/off.",
  },
] as const satisfies readonly ActionDefinition[];

export type ActionGroupActions = typeof actionGroupActions;

// ---------------------------------------------------------------------------
// Augment slots
//
// ActionGroup is a single-group control, so its slot props carry the identity
// and live readout of the *one* group this instance drives. An augment binds a
// Kerbalism/mod-subsystem status describing WHAT that group toggles, e.g.
// "AG3 → radiators": using the group id/datum to scope itself.
//   • `action-group.subsystem`: a richer whole-widget status block in the body.
// ---------------------------------------------------------------------------

/**
 * The context both ActionGroup slots pass to their augments. An
 * augment reads the `groupId` to decide whether/how to describe the toggled
 * subsystem, and can reflect the live `value` / `stateLabel` if it wants to.
 */
export interface ActionGroupSlotContext {
  /** The KSP action group this instance controls (e.g. "AG1", "SAS", "Gear"). */
  groupId: ActionGroupId;
  /** The display label: custom override or the official group name. */
  label: string;
  /** The group's current Value (boolean or numeric readout); `undefined` if unknown. */
  value: unknown;
  /** Rendered state readout: "ON" / "OFF" / a numeric string / NULL_DISPLAY. */
  stateLabel: string;
}

// Declaration-merge the slot ids → props type into core's `SlotRegistry`.
// Co-located here (not a central file) so
// parallel slot work on other widgets can't collide. This makes
// `registerAugment` and `<AugmentSlot name="action-group.subsystem" ...>` type-check
// against `ActionGroupSlotContext` rather than the loose fallback.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "action-group.subsystem": ActionGroupSlotContext;
  }
}

// ---------------------------------------------------------------------------
// Value resolution
// ---------------------------------------------------------------------------

/**
 * Resolves one group's live value off the canonical payloads.
 *
 * A CUSTOM group carries an `index` and is found in `control.actionGroups` by
 * that index: never by array position (position stopped implying identity when
 * the wire shape became a named list) and never by name (two AGX groups may
 * share a display name).
 *
 * A STOCK singleton has no `index` and reads its own typed field. `Stage` is
 * the odd one out: it isn't a control input at all, so it comes off
 * `vessel.structure.currentStage` and is the only NUMERIC readout here.
 */
/**
 * The value a VERDICT may be drawn from: current, or modelled forward to the frame.
 * A stale reading gives nothing, because a judgement cannot be dated: the operator
 * reads a band or a pill as the situation NOW.
 */
function judgeable<T>(reading: Reading<T>): T | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "reckonable") return reading.reckoned.value;
  return undefined;
}

/** Whether a reading went stale, as opposed to never having arrived. */
function notCurrent<T>(reading: Reading<T>): boolean {
  return reading.state === "stale";
}

/**
 * The value of a FACT: something that stays true until an event changes it, and no
 * event can reach us down a link that is not delivering. `whenConfirmedNothing` is
 * what an `absent` tombstone means here, which is a different answer from `pending`
 * and must not collapse into it.
 */
function stillTrue<T, A>(
  reading: Reading<T>,
  whenConfirmedNothing: A,
): T | A | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "stale") return reading.value;
  if (reading.state === "reckonable") return reading.value;
  if (reading.state === "absent") return whenConfirmedNothing;
  return undefined;
}

function resolveGroupValue(
  group: ActionGroup | undefined,
  payload: VesselControl | VesselStructure | undefined,
): unknown {
  if (!group) return undefined;
  const control = payload as VesselControl | undefined;
  // The INDEX is asked before any name, here and in every other decider below.
  // A group carrying one is a custom group whatever the player called it, and
  // a name test that runs first hands "Stage" to the staging branch.
  if (group.index !== undefined) {
    return control?.actionGroups?.find((g) => g.index === group.index)?.state;
  }
  // Stage reads the OTHER topic; see ActionGroupComponent.
  if (group.name === "Stage") {
    return (payload as VesselStructure | undefined)?.currentStage;
  }
  switch (group.name) {
    case "SAS":
      return control?.sas;
    case "RCS":
      return control?.rcs;
    case "Light":
      return control?.lights;
    case "Gear":
      return control?.gear;
    case "Brake":
      return control?.brakes;
    case "Abort":
      return control?.abort;
    case "Precision Control":
      return control?.precisionControl;
    default:
      // A configured id that no longer exists, e.g. a saved AGX group after
      // AGX was uninstalled. Unknown, not false: the pill shows NULL_DISPLAY.
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Delayed-command dispatch (command-surface-delay-audit #1-4): every toggle
// this widget fires (Stage, Abort, SAS/RCS/Gear/Brake/Light, AGX customs)
// actuates the vessel, so it rides `useCommand` instead of the legacy
// `useExecuteAction` string path, the same toggle -> absolute bridge
// `map-command.ts`'s `toggleHome`/`actionGroupHome` apply, but built here
// directly off the group's already-known live `value` (this widget already
// reads it for the state pill), no separate current-value store sample
// needed.
// ---------------------------------------------------------------------------

/** Sentinel: the current value isn't a boolean yet (unknown/numeric Stage
 * read through the wrong branch), so a toggle can't safely be inverted.
 * Mirrors `map-command.ts`'s own `INVALID` contract: never dispatch an
 * ambiguous toggle as a blind set. */
const TOGGLE_INVALID: unique symbol = Symbol("action-group-toggle-invalid");

/**
 * The mapped absolute-set command for one group's toggle, or `null` when the
 * group has no toggle (Precision Control) or isn't recognized. Keyed the
 * same way `map-command.ts`'s `LEGACY_COMMAND_HOMES`/`actionGroupHome`
 * are: an AGX custom (`group.index !== undefined`) always resolves to the
 * shared `setActionGroup` command regardless of name; Stage has its own
 * unconditional (non-invert) command; the remaining stock singletons each
 * have a dedicated absolute-set command.
 */
export function toggleCommandFor(group: ActionGroup): string | null {
  if (group.index !== undefined) return "vessel.control.setActionGroup";
  if (group.name === "Stage") return "vessel.control.stage";
  switch (group.name) {
    case "SAS":
      return "vessel.control.setSas";
    case "RCS":
      return "vessel.control.setRcs";
    case "Light":
      return "vessel.control.setLights";
    case "Gear":
      return "vessel.control.setGear";
    case "Brake":
      return "vessel.control.setBrakes";
    case "Abort":
      return "vessel.control.setAbort";
    default:
      return null; // Precision Control (read-only) or an unrecognized group.
  }
}

/**
 * Builds the wire args for `toggleCommandFor(group)`'s command, inverting
 * the group's own live `value`. Stage takes no args (its handler ignores
 * them, matching `map-command.ts`'s `f.stage` home) and needs no invert.
 * Every other group is `TOGGLE_INVALID` unless `value` is a real boolean:
 * an unresolved/stale read must never be blindly inverted.
 */
export function buildToggleArgs(
  group: ActionGroup,
  value: unknown,
): unknown | typeof TOGGLE_INVALID {
  if (group.index !== undefined) {
    if (typeof value !== "boolean") return TOGGLE_INVALID;
    return { group: group.index, state: !value };
  }
  if (group.name === "Stage") return null;
  if (typeof value !== "boolean") return TOGGLE_INVALID;
  return { enabled: !value };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Resolves this instance's group + live value, then renders the view.
 *
 * The CANONICAL one-arg topic read lives here. This widget's last legacy
 * `useTelemetry("data", group.value)` shim read is GONE: it existed only
 * because the read key was resolved dynamically off the hardcoded
 * ACTION_GROUPS registry (`"v.sasValue"`, `"v.ag1Value"`, …), which is exactly
 * what made this widget the mapTopic coverage scan's own blind spot.
 *
 * `vessel.control` is read ONCE and serves both jobs, it carries the named
 * custom groups the registry derives from AND every stock singleton's value,
 * so the common case costs exactly one subscription, as the single dynamic
 * legacy read did. `Stage` is the sole group whose value lives elsewhere
 * (`vessel.structure.currentStage`; it's a staging command, not a control
 * input), so it branches to a sibling that adds that second subscription only
 * for the instance that actually needs it, rather than every ActionGroup on the
 * dashboard paying for it.
 */
function ActionGroupComponent(
  props: Readonly<ComponentProps<ActionGroupConfig>>,
) {
  const controlReading = useTelemetry("vessel.control");
  /**
   * Two currencies off ONE read, because this record carries both kinds of
   * field.
   *
   * WHICH action groups the vessel has is a fact. The named list changes when
   * the vessel does, and a link that has stopped delivering cannot have carried
   * that event, so the last list received is still the answer. Withholding it
   * would retire a control the operator is plainly still looking at, and worse:
   * an AGX group resolved from nothing degrades to a read-only pill under its
   * configured name, so blanking the registry would quietly take the toggle
   * away rather than mark it uncertain.
   */
  const group = useActionGroupFrom(
    stillTrue(controlReading, undefined),
    props.config?.actionGroupId,
  );

  // Index before name again: only the stock singleton, which carries no index,
  // reads its value off `vessel.structure`.
  if (group && group.index === undefined && group.name === "Stage") {
    return <StageActionGroup {...props} group={group} />;
  }
  /**
   * Whether that group is ON is a judgement, so it goes the other way. The pill
   * is a two-state verdict about the vessel now (an operator reads "ON" as the
   * gear being down, not as the gear having been down), and the same value is
   * inverted to build the toggle's absolute-set args, which this file already
   * refuses to do off an unresolved read. A held boolean would both misstate the
   * craft and command the wrong way.
   */
  return (
    <ActionGroupView
      {...props}
      group={group}
      value={resolveGroupValue(group, judgeable(controlReading))}
      valueNotCurrent={notCurrent(controlReading)}
    />
  );
}

/** The Stage-only leg: see {@link ActionGroupComponent}. */
function StageActionGroup({
  group,
  ...props
}: Readonly<ComponentProps<ActionGroupConfig>> & { group: ActionGroup }) {
  const structure = useTelemetry("vessel.structure");
  /**
   * The current stage is a fact, unlike every other group's state. It moves only
   * when something stages, so it cannot drift while nobody is looking, and the
   * stage command is unconditional (`buildToggleArgs` returns `null` for Stage
   * and never inverts), so no command rides on this number being current.
   * Blanking a stage index that has not changed would cost the operator a
   * readout and buy nothing.
   */
  return (
    <ActionGroupView
      {...props}
      group={group}
      value={stillTrue(structure, undefined)?.currentStage}
      valueNotCurrent={false}
    />
  );
}

function ActionGroupView({
  config,
  onConfigChange,
  w,
  h,
  group,
  value,
  valueNotCurrent,
}: Readonly<ComponentProps<ActionGroupConfig>> & {
  group: ActionGroup | undefined;
  value: unknown;
  /** The state was withheld because it went stale, not because it never came. */
  valueNotCurrent: boolean;
}) {
  const currentLabel = config?.label ?? group?.name ?? "";

  // `value` now arrives as a prop, resolved one-arg off the canonical
  // `vessel.control` / `vessel.structure` Topics by the wrappers above, the
  // last `useTelemetry("data", group.value)` shim read is gone, and with it
  // `mapTopic.coverage`'s dynamic-key blind spot: the ACTION_GROUPS registry
  // no longer carries read keys at all. The `.toggle` side rides `useCommand`
  // (delayed-command-ux migration): `toggleCommandFor`/`buildToggleArgs`
  // below apply the same toggle -> absolute bridge `map-command.ts`'s
  // `toggleHome`/`actionGroupHome` do, off the group's own already-known
  // `value` instead of a separate store sample.
  // These two reads have clean canonical homes of their own:
  //  - `t.isPaused`     -> `time.warp.paused`
  //  - `comm.connected` -> `comms.link.connected`
  /**
   * Both are inputs to one computed verdict, "would this fire if you pressed it
   * now", so both go through `judgeable`. Neither may be answered from a held
   * value: telling the operator the game is paused, or that there is no signal,
   * on the strength of a reading we can no longer vouch for puts a confident
   * reason on the screen for a state that may well have ended. A withheld one
   * lands on the same "nothing to warn about" the never-arrived case already
   * produced, which is the honest silence, the widget claims nothing either way.
   */
  const isPaused = judgeable(useTelemetry("time.warp"))?.paused;
  const commConnected = judgeable(useTelemetry("comms.link"))?.connected;
  const openAlarms = useAlarmsLauncher();

  // The toggle command name depends on which group this instance is
  // configured for (fixed per mount, changes only on a config edit), so it's
  // recomputed every render and handed to `useCommand`, which is fine to
  // call with a varying string, hooks don't care about argument identity.
  const toggleCommand = group ? toggleCommandFor(group) : null;
  const toggleCmd = useCommand(toggleCommand ?? "");
  usePanelDelay(toggleCmd);

  // Inline label editing state
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleToggle = () => {
    if (!group?.toggle || !toggleCommand) return;
    const args = buildToggleArgs(group, value);
    if (args === TOGGLE_INVALID) return;
    void toggleCmd.send(args, { label: `Toggle ${currentLabel}` });
  };

  useActionInput<ActionGroupActions>({
    toggle: (payload) => {
      if (!group) return undefined;
      // Fire on button-press edge only; releases are ignored so one tap = one toggle.
      if (payload.kind === "button" && payload.value !== true) return undefined;
      handleToggle();
      return { [group.name]: value !== true };
    },
  });

  if (!group) {
    return (
      <Panel>
        <Placeholder>No action group configured</Placeholder>
      </Panel>
    );
  }

  // Most groups are boolean (ON/OFF). A few, e.g. Stage's `v.currentStage`:
  // report a numeric state, so coercing every non-true value to OFF mislabels
  // them. Treat numbers as their own readout and only fall back to ON/OFF for
  // genuine booleans.
  const isNumeric = typeof value === "number";
  const isOn = isNumeric ? value > 0 : value === true;
  const isUnknown = value === undefined;
  const stateLabel = isUnknown
    ? NULL_DISPLAY
    : isNumeric
      ? String(value)
      : value === true
        ? "ON"
        : "OFF";

  // Props both augment slots pass down. Built after the `!group`
  // guard, so this is a plain object rather than a hook, no `useMemo` may run
  // conditionally. A fresh reference per render is fine: the live `value`
  // changes anyway, and `AugmentSlot`'s subscription is store-driven.
  const slotContext: ActionGroupSlotContext = {
    groupId: group.name,
    label: currentLabel,
    value,
    stateLabel,
  };

  // Surface the most common reasons the action wouldn't fire if the user
  // pressed it now. Mirrors the legacy action-group response codes 1–4
  // (paused / no power / antenna off / antenna missing), codes 0 and 5 are
  // covered upstream (0 = OK, 5 = handled by `requires: ["flight"]`).
  let unavailableReason: string | null = null;
  // First, because it is the reason the pill above reads NULL_DISPLAY. Without
  // it a withheld state is indistinguishable from one that never arrived, and
  // from a broken widget: the operator sees an empty pill on a dashboard that
  // was showing ON a moment ago and has nothing to read the difference off.
  if (valueNotCurrent) unavailableReason = "State not current";
  else if (isPaused === true) unavailableReason = "Paused";
  else if (commConnected === false) unavailableReason = "No signal";
  // Last, because unlike the three above this one does not stop the press:
  // the registry keeps a configured group operable on purpose and the toggle
  // stays live. It explains the empty pill when nothing else is claiming the
  // line, and yields to any condition that would actually block the action.
  else if (group.provenance === "assumed") unavailableReason = "Not reported";
  // Keyed off the reason actually chosen above, not re-derived, so the two
  // cannot drift apart into a caveat explained by the wrong sentence.
  const unavailableTitle =
    unavailableReason === "State not current"
      ? "The last known state is too old to invert, so the toggle is held"
      : unavailableReason === "Not reported"
        ? "Configured, but no backend has reported this group, so its state is unknown"
        : "The action group can't fire right now";

  // Selective rendering: drop the secondary "official name" line when the
  // widget is narrow. The state pill is itself the toggle control, so it is
  // present at every size (no separate vertical-room gate).
  const cols = w ?? 6;
  const showOfficialName = cols >= 5;
  // Precision Control has no toggle key, the pill stays a read-only indicator
  // there (disabled button) rather than a no-op clickable. A withheld state
  // disables it for the same reason: `buildToggleArgs` refuses a non-boolean, so
  // the press is provably inert, and an inert-looking control beside a stated
  // reason is honest where a live-looking one that swallows the click is not.
  const canToggle = Boolean(group.toggle) && !valueNotCurrent;
  // Bell is reachable from the alarms menu, at tiny size it just crowds the
  // pill and the size-locked button style breaks the layout.
  const showBell = getSizeBucket(w, h) !== "tiny" && Boolean(openAlarms);

  const startEditing = () => {
    setDraft(currentLabel);
    setEditing(true);
    // Focus runs after render
    requestAnimationFrame(() => inputRef.current?.select());
  };

  const commitEdit = () => {
    if (editing && onConfigChange) {
      onConfigChange({
        ...config,
        // Renaming changes the LABEL, so the saved identity must survive it
        // untouched: writing `group.name` here would re-point a custom group's
        // config at whatever singleton shares its name.
        actionGroupId: actionGroupIdOf(group),
        label: draft || undefined,
      });
    }
    setEditing(false);
  };

  const cancelEdit = () => {
    setEditing(false);
  };

  // Only meaningful while editing (Enter commits, Escape cancels the
  // input): the trigger itself is a real `<button>` now, so Enter/Space
  // activation is native and needs no handler of its own.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") commitEdit();
    if (e.key === "Escape") cancelEdit();
  };

  return (
    // The panel names the WIDGET; the group's own name is a control, not a
    // heading. It is an inline rename affordance (a button that swaps in a text
    // input), and `panelTitle` renders its argument inside PanelTitle's h3, so
    // passing it through would nest a button and an input in a heading and
    // uppercase the operator's own label into the bargain. It reads as the
    // first line of the body instead, which is where a control belongs.
    <Panel panelTitle="ACTION GROUP">
      <Cluster justify="between" align="start" gap="md" wrap>
        {editing ? (
          <Stack gap="xs" style={{ flex: 1, minWidth: 0 }}>
            <Input
              ref={inputRef}
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={handleKeyDown}
              onClick={(e) => e.stopPropagation()}
            />
          </Stack>
        ) : (
          // A real `<button>` rather than a `div role="button"`: native
          // Enter/Space activation and a native focus ring, no bespoke
          // keydown handler or focus-visible CSS needed.
          <Stack
            as="button"
            gap="xs"
            onClick={startEditing}
            aria-label={`Rename ${currentLabel}`}
            title="Click to rename"
            style={{
              flex: 1,
              minWidth: 0,
              cursor: "text",
              textAlign: "left",
              background: "none",
              border: "none",
              padding: 0,
              font: "inherit",
            }}
          >
            <Truncate style={{ fontWeight: 600, letterSpacing: "0.05em" }}>
              {currentLabel}
            </Truncate>
            {/* Always show official name as secondary, unless it matches the label */}
            {showOfficialName &&
              config?.label &&
              config.label !== group.name && (
                <Text tone="faint" size="xs">
                  {group.name}
                </Text>
              )}
          </Stack>
        )}
        <Inline gap="sm">
          {showBell && group.toggle && (
            <IconButton
              type="button"
              aria-label={`Set alarm to fire ${currentLabel}`}
              title={`Set alarm to fire ${currentLabel}`}
              onClick={(e) => {
                e.stopPropagation();
                if (!group.toggle || !openAlarms) return;
                openAlarms({
                  name: `Fire ${currentLabel}`,
                  action: group.toggle,
                });
              }}
            >
              <BellIcon />
            </IconButton>
          )}
          <ToggleButton
            active={isOn}
            size="sm"
            disabled={!canToggle}
            onClick={handleToggle}
            aria-label={`Toggle ${currentLabel}`}
            title={unavailableReason ?? `Toggle ${currentLabel}`}
          >
            {stateLabel}
          </ToggleButton>
        </Inline>
      </Cluster>
      {unavailableReason && getSizeBucket(w, h) !== "tiny" && (
        <Badge
          tone="warn"
          size="sm"
          role="status"
          aria-live="polite"
          title={unavailableTitle}
        >
          {unavailableReason}
        </Badge>
      )}
      {/* Whole-widget status block. An Uplink describing what this group
          toggles (e.g. a Kerbalism subsystem) renders here. Empty until bound. */}
      <AugmentSlot name="action-group.subsystem" props={slotContext} />
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Config component (rendered inside modal)
// ---------------------------------------------------------------------------

function ActionGroupConfigComponent({
  config,
  onSave,
}: Readonly<ConfigComponentProps<ActionGroupConfig>>) {
  // The picker lists whatever the elected backend actually reports, under AGX
  // that's the player's own named groups, with no change here.
  const groups = useActionGroups();
  const [actionGroupId, setActionGroupId] = useState<ActionGroupId>(
    config?.actionGroupId ?? "AG1",
  );
  const [label, setLabel] = useState(config?.label ?? "");

  const candidate = useMemo<ActionGroupConfig>(
    () => ({ actionGroupId, label: label.trim() || undefined }),
    [actionGroupId, label],
  );

  useModalSaveBar({
    onSave: () => onSave(candidate),
    value: candidate,
    saved: config ?? {},
  });

  return (
    <ConfigForm>
      <Field>
        <FieldLabel htmlFor="ag-select">Action Group</FieldLabel>
        <Select
          id="ag-select"
          value={actionGroupId}
          onChange={(e) => setActionGroupId(e.target.value as ActionGroupId)}
        >
          {/* Labelled by name, VALUED by identity: a custom group a player
              named after a stock singleton would otherwise save the stock
              singleton's id, and resolve to it. */}
          {groups.map((g) => (
            <option key={actionGroupIdOf(g)} value={actionGroupIdOf(g)}>
              {g.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor="ag-label">Custom Label</FieldLabel>
        <Input
          id="ag-label"
          type="text"
          placeholder={actionGroupId}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <FieldHint>Leave blank to use the action group name.</FieldHint>
      </Field>
    </ConfigForm>
  );
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

registerComponent<ActionGroupConfig>({
  id: "action-group",
  name: "Action Group",
  description:
    "Toggle a KSP action group or system (SAS, RCS, gear, brakes, lights, AG1–AG10).",
  tags: ["control", "telemetry"],
  defaultSize: { w: 6, h: 6 },
  minSize: { w: 3, h: 3 },
  // Compact controls pair nicely two-per-row on mobile.
  mobileWidth: "half",
  component: ActionGroupComponent,
  configComponent: ActionGroupConfigComponent,
  dataRequirements: [],
  defaultConfig: { actionGroupId: "AG1" },
  actions: actionGroupActions,
  augmentSlots: ["action-group.subsystem"],
  requires: ["flight"],
});

export { ActionGroupComponent };
