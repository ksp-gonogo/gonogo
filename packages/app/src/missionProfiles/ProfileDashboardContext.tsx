import { createContext, useContext } from "react";
import type { ProfileDashboard } from "./ProfileDashboard";

const ProfileDashboardContext = createContext<ProfileDashboard | null>(null);

/** Gives the screen's layout controller to what the dashboard draws when it is empty. */
export const ProfileDashboardProvider = ProfileDashboardContext.Provider;

/** The screen's layout controller, or null where no screen mounts one. */
export function useProfileDashboardController(): ProfileDashboard | null {
  return useContext(ProfileDashboardContext);
}
