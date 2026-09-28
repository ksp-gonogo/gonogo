import { createContext, type ReactNode, useContext } from "react";

/**
 * Opens the alarms modal pre-filled to fire an action. The provider lives in
 * the app; a widget hides the affordance when none is mounted.
 */
export interface AlarmsLauncherOptions {
  name?: string;
  /** Action key, e.g. `f.ag1`, `f.stage`, `f.abort`; absent pre-fills no on-fire action. */
  action?: string;
}

export type AlarmsLauncher = (opts: AlarmsLauncherOptions) => void;

const Context = createContext<AlarmsLauncher | null>(null);

/**
 * The Uplink that asked for an alarm; absent on an alarm the operator made.
 * `uplinkName` is denormalised because the alarm outlives an uninstalled Uplink.
 */
export interface AlarmRequestedBy {
  /** The Uplink's id, as its client handle and its mod-side attribute spell it. */
  uplinkId: string;
  /** The Uplink's display name, as it read when the request was made. */
  uplinkName: string;
  /** The requesting Uplink's own name for the thing this alarm is about. */
  key: string;
}

/**
 * Creates an alarm directly, bypassing the modal, for an affordance whose
 * trigger is fully determined by where the operator clicked.
 */
export interface AlarmCreateRequest<Trigger> {
  name?: string;
  trigger: Trigger;
  /** One `(uplinkId, key)` pair is one alarm: a repeated request retargets the existing row. */
  requestedBy?: AlarmRequestedBy;
}

export type AlarmCreator<Trigger> = (req: AlarmCreateRequest<Trigger>) => void;

const CreatorContext = createContext<AlarmCreator<unknown> | null>(null);

/** Finds an existing alarm by trigger, so a bell can toggle it off instead of duplicating it. */
export interface AlarmManagerLookup {
  find: (matcher: (trigger: unknown) => boolean) => string | null;
  remove: (alarmId: string) => void;
}

const ManagerContext = createContext<AlarmManagerLookup | null>(null);

/** An alarm yet to fire, as a widget outside the alarm pipeline sees it. */
export interface PendingAlarmSummary {
  id: string;
  name: string;
  /** The UT a time alarm fires at, or null for a trigger with no instant (a threshold, a contract, an event). */
  ut: number | null;
}

const PendingContext = createContext<readonly PendingAlarmSummary[] | null>(
  null,
);

export function AlarmsLauncherProvider({
  launcher,
  creator,
  manager,
  pending,
  children,
}: {
  launcher: AlarmsLauncher;
  /** Omitted hides every direct-create affordance. */
  creator?: AlarmCreator<unknown>;
  manager?: AlarmManagerLookup;
  /**
   * Soonest first, alarms with no instant last. Omitted means no alarm
   * pipeline, which is not the same answer as an empty list.
   */
  pending?: readonly PendingAlarmSummary[];
  children: ReactNode;
}) {
  return (
    <Context.Provider value={launcher}>
      <CreatorContext.Provider value={creator ?? null}>
        <ManagerContext.Provider value={manager ?? null}>
          <PendingContext.Provider value={pending ?? null}>
            {children}
          </PendingContext.Provider>
        </ManagerContext.Provider>
      </CreatorContext.Provider>
    </Context.Provider>
  );
}

export function useAlarmManager(): AlarmManagerLookup | null {
  return useContext(ManagerContext);
}

/** `null` when no alarm pipeline is mounted; an empty list means nothing is set. */
export function usePendingAlarms(): readonly PendingAlarmSummary[] | null {
  return useContext(PendingContext);
}

/** `null` when no launcher is mounted, and the "set alarm" affordance should hide. */
export function useAlarmsLauncher(): AlarmsLauncher | null {
  return useContext(Context);
}

export function useAlarmCreator<Trigger>(): AlarmCreator<Trigger> | null {
  return useContext(CreatorContext) as AlarmCreator<Trigger> | null;
}
