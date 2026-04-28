import { hashKosScript } from "@gonogo/data";
import { describe, expect, it } from "vitest";
import { buildKosWrapper } from "./kosWrapper";

describe("hashKosScript", () => {
  it("is stable across calls", () => {
    expect(hashKosScript("PRINT 1.")).toBe(hashKosScript("PRINT 1."));
  });

  it("changes when the body changes", () => {
    expect(hashKosScript("PRINT 1.")).not.toBe(hashKosScript("PRINT 2."));
  });

  it("returns a non-empty base-36 string", () => {
    const h = hashKosScript("anything");
    expect(h).toMatch(/^[0-9a-z]+$/);
    expect(h.length).toBeGreaterThan(0);
  });

  it("hashes the empty string to a stable value", () => {
    expect(hashKosScript("")).toBe(hashKosScript(""));
  });
});

describe("buildKosWrapper", () => {
  it("wraps check-and-rewrite in a function and passes body as an arg", () => {
    const out = buildKosWrapper({
      path: "0:/widget_scripts/x.ks",
      body: "PRINT 1.",
      version: "v1",
      args: [],
    });
    expect(out).toContain(`FUNCTION gonogoWrapperEnsure {`);
    expect(out).toContain(
      `PARAMETER targetPath, versionPath, bundledVersion, bodyText.`,
    );
    expect(out).toContain(`LOCAL needsWrite IS TRUE.`);
    expect(out).toContain(`IF EXISTS(targetPath) AND EXISTS(versionPath) {`);
    expect(out).toContain(`OPEN(versionPath):READALL:STRING`);
    // Body content travels via the bodyText parameter — bound at call
    // time, so a cached FUNCTION definition can't carry over the
    // previous dispatch's body.
    expect(out).toContain(`LOG bodyText TO targetPath.`);
    expect(out).toContain(`LOG bundledVersion TO versionPath.`);
    expect(out).toContain(
      `gonogoWrapperEnsure("0:/widget_scripts/x.ks", "0:/widget_scripts/x.ks.ver", "v1", "PRINT 1.").`,
    );
    expect(out).toContain(`RUNPATH("0:/widget_scripts/x.ks").`);
  });

  it("joins body lines with CHAR(10) so a multi-line body is one LOG call", () => {
    const out = buildKosWrapper({
      path: "0:/a.ks",
      body: "LOCAL x IS 1.\nLOCAL y IS 2.\nPRINT x + y.",
      version: "h",
      args: [],
    });
    // Single LOG bodyText call inside the function body.
    const matches = out.match(/LOG bodyText TO targetPath\./g) ?? [];
    expect(matches).toHaveLength(1);
    expect(out).toContain(
      `"LOCAL x IS 1." + CHAR(10) + "LOCAL y IS 2." + CHAR(10) + "PRINT x + y."`,
    );
  });

  it("represents blank body lines as empty fragments in the join", () => {
    const out = buildKosWrapper({
      path: "0:/a.ks",
      body: "PRINT 1.\n\nPRINT 2.",
      version: "h",
      args: [],
    });
    expect(out).toContain(`"PRINT 1." + CHAR(10) + "" + CHAR(10) + "PRINT 2."`);
  });

  it("defines the function before invoking it (REPL is order-sensitive)", () => {
    const out = buildKosWrapper({
      path: "0:/a.ks",
      body: "PRINT 1.",
      version: "v",
      args: [],
    });
    const defIdx = out.indexOf(`FUNCTION gonogoWrapperEnsure`);
    const callIdx = out.indexOf(`gonogoWrapperEnsure(`);
    const runIdx = out.indexOf(`RUNPATH(`);
    expect(defIdx).toBeGreaterThanOrEqual(0);
    expect(callIdx).toBeGreaterThan(defIdx);
    expect(runIdx).toBeGreaterThan(callIdx);
  });

  it("escapes embedded double quotes via CHAR(34) inside the body argument", () => {
    const out = buildKosWrapper({
      path: "0:/a.ks",
      body: `PRINT "hello".`,
      version: "h",
      args: [],
    });
    // Body lives in the function call as `..., "PRINT " + CHAR(34) + …`.
    expect(out).toContain(`"PRINT " + CHAR(34) + "hello" + CHAR(34) + "."`);
  });

  it("forwards numeric, boolean, and string args to RUNPATH", () => {
    const out = buildKosWrapper({
      path: "0:/a.ks",
      body: "PRINT 1.",
      version: "h",
      args: [1.5, true, "hi"],
    });
    expect(out).toContain(`RUNPATH("0:/a.ks", 1.5, true, "hi").`);
  });

  it("escapes a string arg containing a quote", () => {
    const out = buildKosWrapper({
      path: "0:/a.ks",
      body: "PRINT 1.",
      version: "h",
      args: [`a"b`],
    });
    expect(out).toContain(`RUNPATH("0:/a.ks", "a" + CHAR(34) + "b").`);
  });

  it("fragments [KOSDATA] sentinels in body lines so the REPL echo doesn't match the parser", () => {
    const out = buildKosWrapper({
      path: "0:/a.ks",
      body: `PRINT "[KOSDATA]value=" + value + "[/KOSDATA]".`,
      version: "h",
      args: [],
    });
    // The wrapper text must not contain a contiguous parser sentinel
    // anywhere — `[KOSDATA]` and `[/KOSDATA]` would lock the data-source
    // parser onto the wrapper's REPL echo before the script runs.
    expect(out).not.toContain("[KOSDATA]");
    expect(out).not.toContain("[/KOSDATA]");
    // The split point is right after the leading `[`, so each piece is a
    // separate string concatenation. Spot-check the canonical form.
    expect(out).toContain(`"[" + "KOSDATA]value="`);
    expect(out).toContain(`"[" + "/KOSDATA]"`);
  });

  it("fragments [KOSERROR] sentinels too", () => {
    const out = buildKosWrapper({
      path: "0:/a.ks",
      body: `PRINT "[KOSERROR]boom[/KOSERROR]".`,
      version: "h",
      args: [],
    });
    expect(out).not.toContain("[KOSERROR]");
    expect(out).not.toContain("[/KOSERROR]");
  });

  it("fragments sentinels in path/version too — they get echoed as much as the body", () => {
    const out = buildKosWrapper({
      path: "0:/[KOSDATA]/x.ks",
      body: "PRINT 1.",
      version: "v[/KOSDATA]",
      args: [],
    });
    expect(out).not.toContain("[KOSDATA]");
    expect(out).not.toContain("[/KOSDATA]");
  });

  it("ends with a trailing newline so the REPL sees a complete final statement", () => {
    const out = buildKosWrapper({
      path: "0:/a.ks",
      body: "PRINT 1.",
      version: "h",
      args: [],
    });
    expect(out.endsWith("\n")).toBe(true);
  });
});
