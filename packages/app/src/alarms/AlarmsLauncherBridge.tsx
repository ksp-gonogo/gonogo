import {
  type AlarmCreator,
  type AlarmManagerLookup,
  type AlarmsLauncher,
  AlarmsLauncherProvider,
} from "@ksp-gonogo/components";
import { useModal } from "@ksp-gonogo/ui";
import { type ReactNode, useCallback, useMemo } from "react";
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
  const snap = useSnapshot();
  const manager = useMemo<AlarmManagerLookup>(() => {
    return {
      find: (matcher) => {
        for (const a of snap.alarms) {
          if (matcher(a.trigger as unknown)) return a.id;
        }
        return null;
      },
      remove: (id: string) => {
        onDelete(id);
      },
    };
  }, [snap, onDelete]);
  return (
    <AlarmsLauncherProvider
      launcher={launcher}
      creator={creator as AlarmCreator<unknown>}
      manager={manager}
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
