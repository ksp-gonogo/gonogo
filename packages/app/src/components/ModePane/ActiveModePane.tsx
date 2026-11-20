import { type ModeDefinition, useModes } from "@ksp-gonogo/core";
import { getModeLayer, onModeLayerChange } from "@ksp-gonogo/sitrep-client";
import type { ModeId } from "@ksp-gonogo/sitrep-sdk";
import {
  useModeControls,
  useModeState,
  useModeSync,
  useModeTimeline,
} from "@ksp-gonogo/sitrep-sdk/spine";
import { IconButton, Switch, Tooltip } from "@ksp-gonogo/ui-kit";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { ModePane } from "./ModePane";

/* Each mode's own hook answers whether it is on, so each runs in a component of its own. */
function ModeWatch({
  mode,
  report,
}: {
  mode: ModeDefinition;
  report: (id: string, active: boolean) => void;
}) {
  const active = mode.useActive();
  useEffect(() => report(mode.id, active), [mode.id, active, report]);
  return null;
}

const ALWAYS = () => true;

/** What a mode's pane says while its source has supplied nothing: the craft it reads is out of contact, or has not been heard yet. */
const WAITING = "Waiting for the craft";

/** Leaves a mode that has no timeline to carry its own exit, such as a burn preview with no nodes to preview. */
function ExitButton({ mode, name }: { mode: string; name: string }) {
  const { exit } = useModeControls();
  return (
    <Tooltip text={`Exit ${name.toLowerCase()}`}>
      <IconButton
        type="button"
        aria-label={`Exit ${name.toLowerCase()} and return to live data`}
        onClick={() => exit(mode)}
      >
        ✕
      </IconButton>
    </Tooltip>
  );
}

/** The switch between following the shared timeline and keeping this screen's own place on it. */
function SyncSwitch() {
  const [synced, setSynced] = useModeSync();
  return <Switch label="Sync timeline" checked={synced} onChange={setSynced} />;
}

/**
 * The pane and Timeline of the mode the dashboard is in. The mod says which
 * mode that is. While it says `live`, a mode registered on this screen whose
 * `useActive` answers true takes its place, the one with the lowest `order`.
 * Draws nothing for a mode with no sections and no Timeline.
 */
export function ActiveModePane({
  titleFor,
  ownPlace = false,
}: {
  titleFor: (mode: ModeDefinition) => string;
  /** Whether to offer the switch that takes this screen off the shared timeline. */
  ownPlace?: boolean;
}) {
  const modes = useModes();
  const [active, setActive] = useState<Readonly<Record<string, boolean>>>({});
  const report = useCallback((id: string, on: boolean) => {
    setActive((prev) => (prev[id] === on ? prev : { ...prev, [id]: on }));
  }, []);
  const state = useModeState();
  const layer = useSyncExternalStore(onModeLayerChange, getModeLayer);
  const declaredId = state && state.mode !== "live" ? state.mode : undefined;
  const declaredName = state?.name;
  /*
   * A mode that answers Topics shows nothing of its own until its source has
   * spoken for this entry. Until then the mod's timeline, where it holds one,
   * still stands, and the pane says what it is waiting on.
   */
  const waiting =
    declaredId !== undefined &&
    state?.answers === "craft" &&
    !(
      layer &&
      layer.mode === declaredId &&
      layer.entry === Number(state?.entry)
    );
  const noTimeline = state?.noTimeline || (waiting ? WAITING : undefined);
  // The mod says which mode is on. How this screen presents it, its colour among it, is what was registered here under the same id.
  const tone = modes.find((m) => m.id === declaredId)?.tone;
  const declared = useMemo<ModeDefinition | undefined>(
    () =>
      declaredId === undefined
        ? undefined
        : {
            id: declaredId as ModeId,
            name: declaredName ?? declaredId,
            useActive: ALWAYS,
            useTimeline: useModeTimeline,
            ...(noTimeline ? { noTimeline } : {}),
            ...(tone ? { tone } : {}),
          },
    [declaredId, declaredName, noTimeline, tone],
  );
  const mode = declared ?? modes.find((m) => active[m.id] === true);
  // A mode's source may say what the pane is about, such as the craft of a recording. Every screen is told it alike.
  const statedTitle = state?.inputs.find((i) => i.key === "title")?.value;
  return (
    <>
      {modes.map((m) => (
        <ModeWatch key={m.id} mode={m} report={report} />
      ))}
      {mode ? (
        <ModePane
          /*
           * A pane calls its mode's own hooks, so it is mounted afresh
           * whenever those may differ. The mode the mod declares and the
           * mode registered on this screen under the same id are two
           * definitions with different hooks, and one follows the other when
           * the mod's mode ends: a replay ending leaves the registered Replay
           * as this screen's mode for a moment.
           */
          key={declared ? `declared:${mode.id}` : mode.id}
          mode={mode}
          title={(declared && statedTitle) || titleFor(mode)}
          subject={declared ? declared.name.toLowerCase() : undefined}
          notice={waiting ? WAITING : undefined}
          timelineTrailing={
            declared ? (
              <>
                {state?.timeline ? null : (
                  <ExitButton mode={declared.id} name={declared.name} />
                )}
                {ownPlace ? <SyncSwitch /> : null}
              </>
            ) : undefined
          }
        />
      ) : null}
    </>
  );
}
