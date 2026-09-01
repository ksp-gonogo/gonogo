import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildUplinkManifest,
  serialiseUplinkManifest,
  UPLINK_MANIFEST_FILE,
} from "./uplink-manifest";

/**
 * The invariant this file exists for: `gonogo-uplink bundle` and
 * `gonogo-uplink docs` write the SAME bytes for the same Uplink.
 *
 * They used to write nine fields and thirteen under one filename, and no reader
 * of either could tell which the loader honours. The two callers still differ in
 * what they can see (only `docs` evaluates the client, so only `docs` has its
 * registrations), so the check is not "one function, therefore one answer": it is
 * that the two INPUT shapes reach the same output.
 */

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

const COMPAT = {
  apiVersion: "1.0.0",
  uiKitVersion: "0.2.0",
  contractMajor: 14,
  contractMinor: 6,
};

/** A flat Uplink: `uplink.json` beside the client, as the template lays it out. */
function anUplink(options: { declaration?: object; sidecar?: object } = {}) {
  const root = mkdtempSync(join(tmpdir(), "gonogo-manifest-"));
  scratch.push(root);
  const clientDir = join(root, "client");
  mkdirSync(clientDir, { recursive: true });
  writeFileSync(
    join(root, "uplink.json"),
    JSON.stringify(
      options.declaration ?? {
        id: "example",
        name: "Example Uplink",
        author: "you",
        repo: "https://github.com/you/example-uplink",
        minAppVersion: "1.2.0",
      },
    ),
  );
  writeFileSync(
    join(clientDir, "package.json"),
    JSON.stringify({ name: "example-client", version: "0.4.1" }),
  );
  if (options.sidecar) {
    writeFileSync(
      join(clientDir, UPLINK_MANIFEST_FILE),
      JSON.stringify(options.sidecar),
    );
  }
  return clientDir;
}

const REGISTERED = {
  id: "example",
  name: "Example Uplink",
  version: "0.4.1",
  description: "What this Uplink does, in the author's own words.",
};

describe("gonogo-uplink.json", () => {
  it("is the same file whether docs or bundle wrote it", () => {
    // `docs` first, exactly as an author runs it: it writes the sidecar beside
    // the client, and that is where `bundle` recovers what it cannot read.
    const clientDir = anUplink();
    const fromDocs = serialiseUplinkManifest(
      buildUplinkManifest({
        clientDir,
        registered: REGISTERED,
        compat: COMPAT,
        integrity: "sha256-abc",
      }),
    );
    writeFileSync(join(clientDir, UPLINK_MANIFEST_FILE), fromDocs);

    const fromBundle = serialiseUplinkManifest(
      buildUplinkManifest({
        clientDir,
        compat: COMPAT,
        integrity: "sha256-abc",
      }),
    );

    expect(fromBundle).toBe(fromDocs);
  });

  it("carries every field the loader and the Uplinks panel read", () => {
    const manifest = buildUplinkManifest({
      clientDir: anUplink(),
      registered: REGISTERED,
      compat: COMPAT,
      integrity: "",
    });
    expect(manifest).toMatchObject({
      id: "example",
      name: "Example Uplink",
      description: REGISTERED.description,
      author: "you",
      repo: "https://github.com/you/example-uplink",
      version: "0.4.1",
      minAppVersion: "1.2.0",
      bundleUrl: "example/example.client.js",
      integrity: "",
    });
    expect(manifest.sdkVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("names an Uplink with no uplink.json from its own registrations", () => {
    const root = mkdtempSync(join(tmpdir(), "gonogo-manifest-"));
    scratch.push(root);
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "bundled-client", version: REGISTERED.version }),
    );
    const manifest = buildUplinkManifest({
      clientDir: root,
      registered: REGISTERED,
      compat: COMPAT,
      integrity: "",
    });
    /*
     * An Uplink shipped inside the app's own repo has no distribution
     * declaration, and empty is the honest answer for the two fields only that
     * file can supply.
     */
    expect(manifest).toMatchObject({
      id: "example",
      name: "Example Uplink",
      author: "",
      repo: "",
      minAppVersion: "0.0.0",
    });
  });

  it("refuses when uplink.json and the registration disagree", () => {
    const clientDir = anUplink({
      declaration: { id: "example", name: "A Different Name" },
    });
    expect(() =>
      buildUplinkManifest({
        clientDir,
        registered: REGISTERED,
        compat: COMPAT,
        integrity: "",
      }),
    ).toThrow(/can only claim one of them/);
  });

  it("writes the same bytes twice for the same inputs", () => {
    const clientDir = anUplink();
    const once = serialiseUplinkManifest(
      buildUplinkManifest({
        clientDir,
        registered: REGISTERED,
        compat: COMPAT,
        integrity: "",
      }),
    );
    const twice = serialiseUplinkManifest(
      buildUplinkManifest({
        clientDir,
        registered: REGISTERED,
        compat: COMPAT,
        integrity: "",
      }),
    );
    expect(twice).toBe(once);
    expect(once.endsWith("\n")).toBe(true);
  });
});
