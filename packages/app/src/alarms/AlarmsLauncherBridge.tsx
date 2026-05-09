import {
  type AlarmsLauncher,
  AlarmsLauncherProvider,
} from "@gonogo/components";
import { useModal } from "@gonogo/ui";
import { type ReactNode, useCallback } from "react";
import { AlarmsModal, type AlarmsModalProps } from "./AlarmsModal";
import type { AlarmSnapshot } from "./types";

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
  return (
    <AlarmsLauncherProvider launcher={launcher}>
      {children}
    </AlarmsLauncherProvider>
  );
}
