import type {
  ActionDefinition,
  ActionGroup,
  ActionGroupId,
  ComponentProps,
  ConfigComponentProps,
} from "@ksp-gonogo/core";
import {
  AugmentSlot,
  getSizeBucket,
  registerComponent,
  useActionGroupFrom,
  useActionGroups,
  useActionInput,
  useTelemetry,
} from "@ksp-gonogo/core";
import type { InFlightCommand } from "@ksp-gonogo/sitrep-client";
import { useCommand } from "@ksp-gonogo/sitrep-client";
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
  InFlightList,
  type InFlightListItem,
  NULL_DISPLAY,
} from "@ksp-gonogo/ui-kit";
import { useMemo, useRef, useState } from "react";
import styled from "styled-components";
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
//   • `action-group.badges`  : inline in the header row; per-group indicators.
//   • `action-group.sections`: richer whole-widget status block in the body.
// Both receive the same context; the placement differs.
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
// `registerAugment` and `<AugmentSlot name="action-group.badges" ...>` type-check
// against `ActionGroupSlotContext` rather than the loose fallback.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "action-group.badges": ActionGroupSlotContext;
    "action-group.sections": ActionGroupSlotContext;
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
function resolveGroupValue(
  group: ActionGroup | undefined,
  payload: VesselControl | VesselStructure | undefined,
): unknown {
  if (!group) return undefined;
  // Stage reads the OTHER topic; see ActionGroupComponent.
  if (group.name === "Stage") {
    return (payload as VesselStructure | undefined)?.currentStage;
  }
  const control = payload as VesselControl | undefined;
  if (group.index !== undefined) {
    return control?.actionGroups?.find((g) => g.index === group.index)?.state;
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
 * same way `map-command.ts`'s `TELEMACHUS_COMMAND_HOMES`/`actionGroupHome`
 * are: an AGX custom (`group.index !== undefined`) always resolves to the
 * shared `setActionGroup` command regardless of name; Stage has its own
 * unconditional (non-invert) command; the remaining stock singletons each
 * have a dedicated absolute-set command.
 */
export function toggleCommandFor(group: ActionGroup): string | null {
  if (group.name === "Stage") return "vessel.control.stage";
  if (group.index !== undefined) return "vessel.control.setActionGroup";
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
  if (group.name === "Stage") return null;
  if (typeof value !== "boolean") return TOGGLE_INVALID;
  const nextState = !value;
  if (group.index !== undefined) {
    return { group: group.index, state: nextState };
  }
  return { enabled: nextState };
}

/**
 * `InFlightCommand` (sitrep-client) -> `InFlightListItem` (ui-kit, vanilla-
 * safe), same shape as RoboticsConsole/RotorTachometer's own mapping: a
 * toggle's visible effect is it reaching the craft, so this counts down to
 * the reach ETA throughout.
 */
function toInFlightListItems(items: InFlightCommand[]): InFlightListItem[] {
  return items.map((item) => ({
    id: item.id,
    label: item.label || item.command,
    etaSeconds:
      item.predictedPhase === "in-transit"
        ? item.reachEtaSeconds
        : item.replyEtaSeconds,
    phase: item.predictedPhase,
  }));
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
  const control = useTelemetry("vessel.control");
  const group = useActionGroupFrom(control, props.config?.actionGroupId);

  if (group?.name === "Stage") {
    return <StageActionGroup {...props} group={group} />;
  }
  return (
    <ActionGroupView
      {...props}
      group={group}
      value={resolveGroupValue(group, control)}
    />
  );
}

/** The Stage-only leg: see {@link ActionGroupComponent}. */
function StageActionGroup({
  group,
  ...props
}: Readonly<ComponentProps<ActionGroupConfig>> & { group: ActionGroup }) {
  const structure = useTelemetry("vessel.structure");
  return (
    <ActionGroupView {...props} group={group} value={structure?.currentStage} />
  );
}

function ActionGroupView({
  config,
  onConfigChange,
  w,
  h,
  group,
  value,
}: Readonly<ComponentProps<ActionGroupConfig>> & {
  group: ActionGroup | undefined;
  value: unknown;
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
  const isPaused = useTelemetry("time.warp")?.paused;
  const commConnected = useTelemetry("comms.link")?.connected;
  const openAlarms = useAlarmsLauncher();

  // The toggle command name depends on which group this instance is
  // configured for (fixed per mount, changes only on a config edit), so it's
  // recomputed every render and handed to `useCommand`, which is fine to
  // call with a varying string, hooks don't care about argument identity.
  const toggleCommand = group ? toggleCommandFor(group) : null;
  const toggleCmd = useCommand(toggleCommand ?? "");

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
  // pressed it now. Mirrors Telemachus's action-group response codes 1–4
  // (paused / no power / antenna off / antenna missing), codes 0 and 5 are
  // covered upstream (0 = OK, 5 = handled by `requires: ["flight"]`).
  let unavailableReason: string | null = null;
  if (isPaused === true) unavailableReason = "Paused";
  else if (commConnected === false) unavailableReason = "No signal";

  // Selective rendering: drop the secondary "official name" line when the
  // widget is narrow. The state pill is itself the toggle control, so it is
  // present at every size (no separate vertical-room gate).
  const cols = w ?? 6;
  const showOfficialName = cols >= 5;
  // Precision Control has no toggle key, the pill stays a read-only indicator
  // there (disabled button) rather than a no-op clickable.
  const canToggle = Boolean(group.toggle);
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
        actionGroupId: group.name,
        label: draft || undefined,
      });
    }
    setEditing(false);
  };

  const cancelEdit = () => {
    setEditing(false);
  };

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
    <Panel
      panelTitle="ACTION GROUP"
      panelAside={
        /* Badges only. The bell and the toggle act on the group NAME, so they
           belong on its line in the body: in the aside they wrapped onto their
           own row ABOVE the label, which read as chrome for the panel rather
           than controls for the group. */
        <AugmentSlot name="action-group.badges" props={slotContext} />
      }
    >
      <Header>
        <LabelArea
          role={editing ? undefined : "button"}
          tabIndex={editing ? undefined : 0}
          onClick={editing ? undefined : startEditing}
          onKeyDown={
            editing
              ? undefined
              : (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    startEditing();
                  }
                }
          }
          aria-label={editing ? undefined : `Rename ${currentLabel}`}
          title="Click to rename"
        >
          {editing ? (
            <LabelInput
              ref={inputRef}
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={handleKeyDown}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <GroupLabel>{currentLabel}</GroupLabel>
          )}
          {/* Always show official name as secondary, unless it matches the label */}
          {showOfficialName && config?.label && config.label !== group.name && (
            <OfficialName>{group.name}</OfficialName>
          )}
        </LabelArea>
        <HeaderRight>
          {showBell && group.toggle && (
            <AlarmIconButton
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
            </AlarmIconButton>
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
        </HeaderRight>
      </Header>
      {unavailableReason && getSizeBucket(w, h) !== "tiny" && (
        <UnavailableNotice
          role="status"
          aria-live="polite"
          title="The action group can't fire right now"
        >
          {unavailableReason}
        </UnavailableNotice>
      )}
      {getSizeBucket(w, h) !== "tiny" && (
        <InFlightList
          items={toInFlightListItems(toggleCmd.inFlight)}
          ariaLabel={`${currentLabel}: in flight`}
        />
      )}
      {/* Richer whole-widget status block: the section-level counterpart to the
          inline badges. An Uplink describing what this group toggles
          (e.g. a Kerbalism subsystem) renders here. Empty until bound. */}
      <AugmentSlot name="action-group.sections" props={slotContext} />
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
          {groups.map((g) => (
            <option key={g.name} value={g.name}>
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
  augmentSlots: ["action-group.badges", "action-group.sections"],
  requires: ["flight"],
});

export { ActionGroupComponent };

// ---------------------------------------------------------------------------
// Styles: component
// ---------------------------------------------------------------------------

const Header = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-8);
  /* Wraps rather than crushing the label: at a narrow tile the controls drop
     UNDER the name they act on, which keeps both readable and keeps them
     associated. */
  flex-wrap: wrap;
  /* No padding: Panel.Body supplies the inset now. This used to self-pad
     because the widget rendered its own header against a padless panel. */
`;

const LabelArea = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  flex: 1;
  min-width: 0;
  cursor: text;

  &:focus-visible {
    /* Focus-ring geometry, not surface chrome: this radius shapes the ring
       drawn by the outline above and tracks that recipe, not the widget's
       radius scale. Left literal with the outline/offset it belongs to. */
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
    border-radius: 2px;
  }
`;

const GroupLabel = styled.span`
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  font-weight: 600;
  letter-spacing: 0.05em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const OfficialName = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-faint);
  letter-spacing: 0.04em;
`;

const LabelInput = styled.input`
  background: var(--color-surface-raised);
  border: 1px solid var(--color-text-faint);
  border-radius: var(--radius-xs);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-weight: 600;
  letter-spacing: 0.05em;
  padding: var(--space-hair) var(--space-4);
  width: 100%;
  box-sizing: border-box;
  outline: none;

  &:focus {
    border-color: var(--color-accent-fg);
  }
`;

const HeaderRight = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-6);
  flex-shrink: 0;
`;

const UnavailableNotice = styled.div`
  margin-top: var(--space-4);
  padding: var(--space-2) var(--space-6);
  background: transparent;
  /* Token name was "warn", not "warning": the real token is
     --color-status-warning-*, so this always missed and silently fell back
     to --color-text-faint, a plain grey that reads as ordinary copy instead
     of the "can't fire right now" warning it's meant to be. Same
     saturated-bg-as-text-on-dark-surface treatment GoNoGoComponent's minor
     badge already uses. */
  border: 1px solid var(--color-status-warning-bg);
  border-radius: var(--radius-xs);
  font-size: var(--font-size-2xs);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-status-warning-bg);
  align-self: flex-start;
`;

const AlarmIconButton = styled.button`
  background: transparent;
  border: none;
  padding: var(--space-2);
  color: var(--color-text-faint);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-xs);

  &:hover {
    color: var(--color-accent-fg);
  }
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;
