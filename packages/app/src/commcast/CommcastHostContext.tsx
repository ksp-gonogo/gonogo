import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import type { CommcastHostService } from "./CommcastHostService";

const CommcastHostContext = createContext<CommcastHostService | null>(null);

export function CommcastHostProvider({
  service,
  children,
}: {
  service: CommcastHostService;
  children: ReactNode;
}) {
  return (
    <CommcastHostContext.Provider value={service}>
      {children}
    </CommcastHostContext.Provider>
  );
}

/**
 * The host's canonical thread, or null on a screen that does not own one
 * (every peer). Null-returning rather than throwing for the same reason
 * `usePeerClient` is: the widget renders on both sides and branching on which
 * end it is at should not be a crash.
 */
export function useCommcastHostOptional(): CommcastHostService | null {
  return useContext(CommcastHostContext);
}
