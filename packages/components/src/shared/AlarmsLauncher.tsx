import { createContext, type ReactNode, useContext } from "react";

/**
 * Lightweight contract for "open the alarms modal pre-populated to fire
 * this Telemachus action" — used by component widgets (e.g. ActionGroup)
 * to avoid the round trip of opening alarms manually and re-typing the
 * action key.
 *
 * The provider lives in `@gonogo/app` (it's the only layer that has the
 * AlarmHostService / AlarmClientService and the ModalProvider it needs to
 * portal the modal). Components stay framework-agnostic — they call the
 * launcher when present and hide the affordance otherwise. Defining the
 * contract here (rather than in app) keeps `@gonogo/components` from
 * having a circular import on `@gonogo/app`.
 */
export interface AlarmsLauncherOptions {
  /** Pre-fills the alarm name. Optional. */
  name?: string;
  /** Telemachus action key, e.g. `f.ag1`, `f.stage`, `f.abort`. */
  action: string;
}

export type AlarmsLauncher = (opts: AlarmsLauncherOptions) => void;

const Context = createContext<AlarmsLauncher | null>(null);

/**
 * Direct-create contract for "alarm me when X" affordances that don't
 * need the modal's free-form trigger editor — the trigger is fully
 * determined by where the operator clicked (e.g. Mission Director's
 * bell next to a contract parameter creates a contract-parameter
 * alarm with the contract id + parameter title baked in). Bypasses
 * the modal and creates the alarm directly via the host's onAdd
 * callback.
 *
 * Generic over the trigger type so this stays in
 * `@gonogo/components/shared` (no `@gonogo/app` import) — the caller
 * supplies a trigger of whatever shape; the host bridge unwraps it.
 */
export interface AlarmCreateRequest<TTrigger> {
  name?: string;
  trigger: TTrigger;
}

export type AlarmCreator<TTrigger> = (
  req: AlarmCreateRequest<TTrigger>,
) => void;

const CreatorContext = createContext<AlarmCreator<unknown> | null>(null);

/**
 * Lookup hook for "is there already an alarm matching this trigger?". Lets
 * a widget render a stateful bell (set / unset) and toggle off the existing
 * alarm rather than duplicating it. Returns the alarm id when one matches,
 * or null when no match (or the manager isn't mounted).
 *
 * `matcher` should be a stable function (memoised by the caller) since this
 * hook re-runs it on every alarm snapshot change.
 */
export interface AlarmManagerLookup {
  find: (matcher: (trigger: unknown) => boolean) => string | null;
  remove: (alarmId: string) => void;
}

const ManagerContext = createContext<AlarmManagerLookup | null>(null);

export function AlarmsLauncherProvider({
  launcher,
  creator,
  manager,
  children,
}: {
  launcher: AlarmsLauncher;
  /**
   * Optional direct-create handler. When omitted, widgets that depend on
   * direct-create (e.g. Mission Director's parameter bell) hide their
   * affordance — same fallback as `useAlarmsLauncher` returning null.
   */
  creator?: AlarmCreator<unknown>;
  /**
   * Optional lookup + remove handler so widgets can render a "set / unset"
   * bell state and toggle the alarm off without re-opening the modal.
   */
  manager?: AlarmManagerLookup;
  children: ReactNode;
}) {
  return (
    <Context.Provider value={launcher}>
      <CreatorContext.Provider value={creator ?? null}>
        <ManagerContext.Provider value={manager ?? null}>
          {children}
        </ManagerContext.Provider>
      </CreatorContext.Provider>
    </Context.Provider>
  );
}

export function useAlarmManager(): AlarmManagerLookup | null {
  return useContext(ManagerContext);
}

/**
 * Returns the launcher when one is mounted, or `null` (e.g. test environments
 * with no alarms wiring). Consumers should hide the "set alarm" affordance
 * when this returns null.
 */
export function useAlarmsLauncher(): AlarmsLauncher | null {
  return useContext(Context);
}

export function useAlarmCreator<TTrigger>(): AlarmCreator<TTrigger> | null {
  return useContext(CreatorContext) as AlarmCreator<TTrigger> | null;
}
