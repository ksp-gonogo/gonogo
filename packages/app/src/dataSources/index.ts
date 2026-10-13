// Importing these modules triggers registerDataSource() for each source.
// The kerboscript-execution Uplink client owns its own registration now,
// see main.tsx's widget-bundle import / the runtime Uplink loader.
import "./missionHistory";
import "./sitrep";
import { seedKspHostDefaults } from "./seedKspHost";

/**
 * Settles once the first-run `KSP_HOST` seed (bundle deployments) has been
 * applied or found absent. Sources that connect before it settles are restarted
 * by their own seed hooks; a one-shot read of the game host waits on this.
 * Never rejects.
 */
export const kspHostSeeded: Promise<void> = seedKspHostDefaults();
