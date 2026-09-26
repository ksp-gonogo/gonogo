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
  /** The vessel the host is observing; the host clears triggers armed for any other. */
  vesselName: string | null;
}

export const EMPTY_TRIGGER_SNAPSHOT: TriggerSnapshot = {
  triggers: [],
  vesselName: null,
};

/**
 * The maneuver-trigger surface. The main screen's host service owns the list,
 * evaluates conditions and dispatches burns; a station's client service
 * mirrors it and sends arm and cancel over PeerJS.
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

/** The provided trigger service, or null outside any provider, where widgets fall back to local state. */
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
