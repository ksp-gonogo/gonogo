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
 * The first-party Uplink clients built as standalone, runtime-loadable ESM
 * bundles. Each is emitted to public/uplinks/<id>.client.js and recorded in the
 * local registry fixture. Adding another Uplink here is the whole change.
 *
 * Lives outside `src/` on purpose. A build has to name what it builds, but the
 * SHIPPED app must not carry a list of first-party Uplink ids: the loader
 * derives what to load from the live roster, and an app that also knows three
 * names by heart contradicts the decentralised model (mod names inside `src/`
 * are separately what the mod-ownership boundary guard exists to stop).
 * `src/uplinks/externals/runtimeLink.test.ts` reads this same list rather than
 * keeping a parallel one.
 */
export const UPLINK_BUNDLE_TARGETS: UplinkBundleTarget[] = [
  {
    id: "scansat",
    name: "SCANsat",
    author: "jonpepler",
    repo: "ksp-gonogo/GonogoScansatUplink",
    clientDir: resolve(modDir, "GonogoScansatUplink/client"),
  },
  {
    id: "kos",
    name: "kOS",
    author: "jonpepler",
    repo: "ksp-gonogo/GonogoKosUplink",
    clientDir: resolve(modDir, "GonogoKosUplink/client"),
  },
  {
    id: "kerbcast",
    name: "Kerbcast",
    author: "jonpepler",
    repo: "ksp-gonogo/GonogoKerbcastUplink",
    clientDir: resolve(modDir, "GonogoKerbcastUplink/client"),
  },
];
