import {
  type AlarmCreator,
  type AlarmsLauncher,
  AlarmsLauncherProvider,
} from "@gonogo/components";
import { useModal } from "@gonogo/ui";
import { type ReactNode, useCallback } from "react";
import { AlarmsModal, type AlarmsModalProps } from "./AlarmsModal";
import type { AlarmSnapshot, AlarmTrigger } from "./types";

/**
 * Provides an `AlarmsLauncher` to the subtree that wraps `useModal().open`
 * so widgets (e.g. `ActionGroup`) can open the alarms modal pre-populated
 * with `onFire` set to a chosen Telemachus action key. Identical wiring
 * for main + station — only the backing snapshot/CRUD callbacks change,
 * which the screens already build for `AlarmsFab`.
 */
export function AlarmsLauncherBridge({
  useSnapshot,
  onAdd,
  onUpdate,
  onDelete,
  children,
}: {
  useSnapshot: () => AlarmSnapshot;
  onAdd: AlarmsModalProps["onAdd"];
  onUpdate: AlarmsModalProps["onUpdate"];
  onDelete: AlarmsModalProps["onDelete"];
  children: ReactNode;
}) {
  const { open } = useModal();
  const launcher: AlarmsLauncher = useCallback(
    (opts) => {
      open(
        <AlarmsModal
          useSnapshot={useSnapshot}
          onAdd={onAdd}
          onUpdate={onUpdate}
          onDelete={onDelete}
          prefill={{
            name: opts.name,
            onFire: [{ kind: "action-group", action: opts.action }],
          }}
        />,
        { title: "Mission Alarms" },
      );
    },
    [open, useSnapshot, onAdd, onUpdate, onDelete],
  );
  // Direct-create path used by Mission Director's parameter bells. Skips
  // the modal entirely — the click already encodes everything the alarm
  // needs (contract id, parameter title, target state).
  const creator: AlarmCreator<AlarmTrigger> = useCallback(
    (req) => {
      onAdd({
        name: req.name?.trim() || defaultNameForTrigger(req.trigger),
        trigger: req.trigger,
      });
    },
    [onAdd],
  );
  return (
    <AlarmsLauncherProvider
      launcher={launcher}
      creator={creator as AlarmCreator<unknown>}
    >
      {children}
    </AlarmsLauncherProvider>
  );
}

function defaultNameForTrigger(trigger: AlarmTrigger): string {
  if (trigger.kind === "contract-parameter") {
    return `${trigger.parameterTitle} → ${trigger.targetState}`;
  }
  return "Alarm";
}
