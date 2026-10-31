import {
  createContext,
  type ReactNode,
  useContext,
  useSyncExternalStore,
} from "react";
import type { HostRole, HostRoleState } from "./HostRole";
import type { HostRecordView } from "./hostRecord";

const HostRoleContext = createContext<HostRole | null>(null);

let registered: HostRole | null = null;
const registryListeners = new Set<() => void>();

/**
 * Make `role` the one a modal reads. A modal renders in a portal above the
 * screen, out of reach of the screen's context. Returns the release.
 */
export function registerHostRole(role: HostRole): () => void {
  registered = role;
  for (const listener of [...registryListeners]) listener();
  return () => {
    if (registered !== role) return;
    registered = null;
    for (const listener of [...registryListeners]) listener();
  };
}

function subscribeRegistry(listener: () => void): () => void {
  registryListeners.add(listener);
  return () => {
    registryListeners.delete(listener);
  };
}

const readRegistry = () => registered;

/** Makes this local screen's host role readable below. */
export function HostRoleProvider({
  role,
  children,
}: {
  role: HostRole;
  children: ReactNode;
}) {
  return (
    <HostRoleContext.Provider value={role}>{children}</HostRoleContext.Provider>
  );
}

/** This local screen's host role, or `null` on a screen that has none, such as a station. */
export function useHostRole(): HostRole | null {
  const fromContext = useContext(HostRoleContext);
  const fromRegistry = useSyncExternalStore(
    subscribeRegistry,
    readRegistry,
    readRegistry,
  );
  return fromContext ?? fromRegistry;
}

const NO_ROLE: HostRoleState = { kind: "waiting" };
const noSubscription = () => () => {};

/** Where this screen stands with the host role, re-rendering as it changes. */
export function useHostRoleState(): HostRoleState {
  const role = useHostRole();
  return useSyncExternalStore(
    role ? (cb) => role.subscribe(cb) : noSubscription,
    () => role?.state ?? NO_ROLE,
    () => role?.state ?? NO_ROLE,
  );
}

/** The game's host record as this screen last read it, or `null` before it has. */
export function useHostRecord(): HostRecordView | null {
  const state = useHostRoleState();
  return state.kind === "waiting" ? null : state.record;
}
