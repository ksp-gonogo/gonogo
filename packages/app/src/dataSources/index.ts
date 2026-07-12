// Importing these modules triggers registerDataSource() for each source.
import "./kos";
import "./missionHistory";
import "./sitrep";
import "@ksp-gonogo/kerbcast-feed";
import { seedKspHostDefaults } from "./seedKspHost";

// First-run KSP_HOST seeding (bundle deployments). Fire-and-forget: any
// already-started connection attempts are restarted by the per-source seed
// hooks when the relay reports a host. No-op outside the bundle.
void seedKspHostDefaults();
