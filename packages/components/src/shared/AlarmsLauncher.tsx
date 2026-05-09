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

export function AlarmsLauncherProvider({
  launcher,
  children,
}: {
  launcher: AlarmsLauncher;
  children: ReactNode;
}) {
  return <Context.Provider value={launcher}>{children}</Context.Provider>;
}

/**
 * Returns the launcher when one is mounted, or `null` (e.g. test environments
 * with no alarms wiring). Consumers should hide the "set alarm" affordance
 * when this returns null.
 */
export function useAlarmsLauncher(): AlarmsLauncher | null {
  return useContext(Context);
}
