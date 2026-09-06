import { resolve } from "node:path";

const modDir = resolve(import.meta.dirname, "../../mod");

/** One Uplink client this repo builds as a standalone, runtime-loadable bundle. */
export interface UplinkBundleTarget {
  id: string;
  name: string;
  author: string;
  repo: string;
  clientDir: string;
}

/**
 * The Uplink clients this repo builds as standalone, runtime-loadable ESM
 * bundles. Each is emitted to public/uplinks/<id>.client.js and recorded in the
 * local registry fixture. Adding another Uplink here is the whole change.
 *
 * This is EVERY Uplink client the repo ships, and that is the point. There used
 * to be two lists: this one, and nine `import("@ksp-gonogo/gonogo-*-uplink")`
 * calls in `src/main.tsx` that registered the rest at build time. The second
 * list was a privilege no outside author could reach, because a static import
 * requires being inside this build. Its stated reason was bootstrap timing on a
 * station, and the timing had already been solved: `StationUplinkLoader` gates
 * the Dashboard until the load settles, and the SDK's runtime Topic registry is
 * subscribable precisely so a Topic registered after the provider mounted is
 * still carried. So the imports bought nothing and cost the app one path for
 * Uplinks we wrote and another for everybody else's.
 *
 * Lives outside `src/` on purpose. A build has to name what it builds, but the
 * SHIPPED app must not carry a list of Uplink ids: the loader derives what to
 * load from the live roster, and an app that also knows eleven names by heart
 * contradicts the decentralised model (mod names inside `src/` are separately
 * what the mod-ownership boundary guard exists to stop).
 * `src/uplinks/externals/runtimeLink.test.ts` reads this same list rather than
 * keeping a parallel one, and so does `src/uplinks/noBakedUplinkIds.test.ts`.
 */
export const UPLINK_BUNDLE_TARGETS: UplinkBundleTarget[] = [
  {
    id: "kos",
    name: "kOS",
    author: "jonpepler",
    repo: "ksp-gonogo/GonogoKosUplink",
    clientDir: resolve(modDir, "GonogoKosUplink/client"),
  },
  {
    id: "kerbalism",
    name: "Kerbalism",
    author: "jonpepler",
    repo: "ksp-gonogo/GonogoKerbalismUplink",
    clientDir: resolve(modDir, "GonogoKerbalismUplink/client"),
  },
  {
    id: "mechjeb",
    name: "MechJeb",
    author: "jonpepler",
    repo: "ksp-gonogo/GonogoMechJebUplink",
    clientDir: resolve(modDir, "GonogoMechJebUplink/client"),
  },
  {
    id: "principia",
    name: "Principia",
    author: "jonpepler",
    repo: "ksp-gonogo/GonogoPrincipiaUplink",
    clientDir: resolve(modDir, "GonogoPrincipiaUplink/client"),
  },
  {
    /*
     * Bundled IN the core mod DLL (Gonogo.KSP/BreakingGroundUplink.cs, like
     * PartsUplink/VesselUplink) rather than shipping its own assembly, so the
     * CLIENT half is the only part of it that lives in its own directory. That
     * changes nothing here: the roster reports the id either way, so the client
     * loads down the same path as every other.
     */
    id: "breakingGround",
    name: "Breaking Ground",
    author: "jonpepler",
    repo: "ksp-gonogo/GonogoBreakingGroundUplink",
    clientDir: resolve(modDir, "GonogoBreakingGroundUplink/client"),
  },
  {
    id: "realantennas",
    name: "RealAntennas",
    author: "jonpepler",
    repo: "ksp-gonogo/GonogoRealAntennasUplink",
    clientDir: resolve(modDir, "GonogoRealAntennasUplink/client"),
  },
  {
    id: "rp1",
    name: "RP-1 Space Centre",
    author: "jonpepler",
    repo: "ksp-gonogo/GonogoRp1Uplink",
    clientDir: resolve(modDir, "GonogoRp1Uplink/client"),
  },
  {
    id: "aero",
    name: "Aerodynamics",
    author: "jonpepler",
    repo: "ksp-gonogo/GonogoFerramAerospaceResearchUplink",
    clientDir: resolve(modDir, "GonogoFerramAerospaceResearchUplink/client"),
  },
];
