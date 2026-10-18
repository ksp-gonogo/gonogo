import { createContext, useContext } from "react";

/** Saves what the player changed on a step, resolving false when the step must stay open. */
export type LeaveSave = () => Promise<boolean>;

/**
 * Where a step's forms register a save the setup runs before it moves to
 * another step. Each registration returns its own removal.
 */
export type RegisterLeaveSave = (save: LeaveSave) => () => void;

export const LeaveGuardContext = createContext<RegisterLeaveSave | undefined>(
  undefined,
);

/** The setup's registration, or undefined outside the setup. */
export function useRegisterLeaveSave(): RegisterLeaveSave | undefined {
  return useContext(LeaveGuardContext);
}
