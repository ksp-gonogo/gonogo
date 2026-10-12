import { createContext, useContext } from "react";
import type { ComponentHeldOpen } from "../types";

/**
 * Why the dashboard is showing this widget although a game state it requires is not met, or undefined while every requirement is met. Provided by the gate that let it through.
 */
export const HeldOpenContext = createContext<ComponentHeldOpen | undefined>(
  undefined,
);

/** The reason this widget is open past an unmet requirement, for one that shows only a record of a past flight then. */
export function useHeldOpen(): ComponentHeldOpen | undefined {
  return useContext(HeldOpenContext);
}
