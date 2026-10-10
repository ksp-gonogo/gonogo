import { createContext, useContext } from "react";

/**
 * Whether the mod has refused this screen's chosen command centre on the
 * current connection, so the session sits wherever a fresh connection starts
 * and every reading on screen is that centre's, not the chosen one's.
 */
export const VantageRefusedContext = createContext(false);

export function useVantageRefused(): boolean {
  return useContext(VantageRefusedContext);
}
