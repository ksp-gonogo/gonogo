import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import type { CommcastLog } from "./CommcastLog";

const CommcastLogContext = createContext<CommcastLog | null>(null);

/**
 * Hands the screen's log down from wherever it was built.
 *
 * It exists at all because a log must outlive the widget: a message addressed
 * here arrives whether or not anybody has the Commcast tile on their dashboard,
 * and a log created by the widget would start empty every time the tile was
 * added back. This is NOT the host-authoritative provider it replaces: what it
 * carries is one vantage's OWN log, and the host's copy is its own, not
 * everybody's.
 */
export function CommcastLogProvider({
  log,
  children,
}: {
  log: CommcastLog;
  children: ReactNode;
}) {
  return (
    <CommcastLogContext.Provider value={log}>
      {children}
    </CommcastLogContext.Provider>
  );
}

/** The screen's log, or null on a screen that builds its own. */
export function useCommcastLogOptional(): CommcastLog | null {
  return useContext(CommcastLogContext);
}
