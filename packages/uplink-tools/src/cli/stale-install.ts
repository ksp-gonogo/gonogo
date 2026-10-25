import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SDK = "@ksp-gonogo/sitrep-sdk";

const release = (text: string): [number, number, number] | undefined => {
  const m = text.match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
};

const readJson = (file: string): unknown =>
  existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;

/**
 * Describes the fault when the sdk installed for a client is older than the
 * version its own package.json asks for, which stamps a manifest the app
 * refuses as built for a previous extension API. Returns nothing when the
 * install satisfies the pin or the pin is not a version number (a workspace or
 * tag specifier). Used by `bundle` before it stamps the manifest.
 */
export function staleInstallFault(
  clientDir: string,
  installedSdkDir: string,
): string | undefined {
  const own = readJson(join(clientDir, "package.json"));
  const installed = readJson(join(installedSdkDir, "package.json"));
  let pin: string | undefined;
  for (const group of ["dependencies", "devDependencies", "peerDependencies"]) {
    const value = Reflect.get(Object(Reflect.get(Object(own), group)), SDK);
    if (typeof value === "string") {
      pin = value;
      break;
    }
  }
  const version = Reflect.get(Object(installed), "version");
  if (pin === undefined || typeof version !== "string") return undefined;
  const wanted = release(pin);
  const have = release(version);
  if (!wanted || !have) return undefined;
  for (let i = 0; i < 3; i++) {
    if (have[i] > wanted[i]) return undefined;
    if (have[i] < wanted[i]) {
      return (
        `${SDK} ${version} is installed in ${installedSdkDir}, but package.json asks for ${pin}. ` +
        "A bundle built now would declare the older extension API and the app would refuse it. " +
        "node_modules is stale: run npm install, then build again."
      );
    }
  }
  return undefined;
}
