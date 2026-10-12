// Importing these modules triggers registerDataSource() for each source.
// The kerboscript-execution Uplink client owns its own registration now,
// see main.tsx's widget-bundle import / the runtime Uplink loader.
import "./missionHistory";
import "./sitrep";
import { seedKspHostDefaults } from "./seedKspHost";

// First-run KSP_HOST seeding (bundle deployments). Fire-and-forget: any
// already-started connection attempts are restarted by the per-source seed
// hooks when the relay reports a host. No-op outside the bundle.
void seedKspHostDefaults();
