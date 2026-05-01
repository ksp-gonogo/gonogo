import type { ReactNode } from "react";
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
} from "react";
import type {
  ArmedTrigger,
  FrozenPlanInputs,
  ThresholdOp,
} from "./triggerTypes";

export interface ArmTriggerInput {
  dataKey: string;
  op: ThresholdOp;
  value: number;
  inputs: FrozenPlanInputs;
}

export interface TriggerSnapshot {
  triggers: readonly ArmedTrigger[];
  /** Name of the vessel the host is currently observing. Triggers
   *  associated with a different vessel are auto-cleared by the host. */
  vesselName: string | null;
}

export const EMPTY_TRIGGER_SNAPSHOT: TriggerSnapshot = {
  triggers: [],
  vesselName: null,
};

/**
 * Surface every consumer of the maneuver-trigger feature uses. Two
 * implementations: the host service on the main screen (owns the
 * canonical list, evaluates conditions, dispatches burns) and the client
 * service on stations (mirrors the host snapshot, sends arm/cancel
 * commands over PeerJS).
 */
export interface ManeuverTriggerService {
  snapshot(): TriggerSnapshot;
  subscribe(cb: (snap: TriggerSnapshot) => void): () => void;
  arm(input: ArmTriggerInput): void;
  cancel(id: string): void;
}

const ManeuverTriggerContext = createContext<ManeuverTriggerService | null>(
  null,
);

export function ManeuverTriggerProvider({
  service,
  children,
}: {
  service: ManeuverTriggerService;
  children: ReactNode;
}) {
  return createElement(
    ManeuverTriggerContext.Provider,
    { value: service },
    children,
  );
}

/** Returns the trigger service if one is wired up, or null when the
 *  widget is rendered outside any provider (legacy main-screen test
 *  harness, storybook, etc.). Widgets fall back to local-only state. */
export function useManeuverTriggerService(): ManeuverTriggerService | null {
  return useContext(ManeuverTriggerContext);
}

/** Reactive snapshot for React consumers. Updates on every service emit. */
export function useTriggerSnapshot(
  service: ManeuverTriggerService,
): TriggerSnapshot {
  const [snap, setSnap] = useState(() => service.snapshot());
  useEffect(() => service.subscribe(setSnap), [service]);
  return snap;
}
