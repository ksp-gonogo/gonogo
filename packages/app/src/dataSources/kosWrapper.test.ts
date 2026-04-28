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
  it("wraps the check-and-rewrite logic in a function with proper scope", () => {
    const out = buildKosWrapper({
      path: "0:/widget_scripts/x.ks",
      body: "PRINT 1.",
      version: "v1",
      args: [],
    });
    expect(out).toContain(`FUNCTION gonogoWrapperEnsure {`);
    expect(out).toContain(`PARAMETER targetPath, versionPath, bundledVersion.`);
    expect(out).toContain(`LOCAL needsWrite IS TRUE.`);
    expect(out).toContain(`IF EXISTS(targetPath) AND EXISTS(versionPath) {`);
    expect(out).toContain(`OPEN(versionPath):READALL:STRING`);
    expect(out).toContain(`LOG "PRINT 1." TO targetPath.`);
    expect(out).toContain(`LOG bundledVersion TO versionPath.`);
    // Function call passes path/verPath/version explicitly — no top-level
    // globals leaked into the REPL session.
    expect(out).toContain(
      `gonogoWrapperEnsure("0:/widget_scripts/x.ks", "0:/widget_scripts/x.ks.ver", "v1").`,
    );
    expect(out).toContain(`RUNPATH("0:/widget_scripts/x.ks").`);
  });

  it("emits one LOG per body line, preserving order", () => {
    const out = buildKosWrapper({
      path: "0:/a.ks",
      body: "LOCAL x IS 1.\nLOCAL y IS 2.\nPRINT x + y.",
      version: "h",
      args: [],
    });
    const logIndex = (s: string) => out.indexOf(`LOG "${s}" TO targetPath.`);
    expect(logIndex("LOCAL x IS 1.")).toBeGreaterThan(-1);
    expect(logIndex("LOCAL y IS 2.")).toBeGreaterThan(-1);
    expect(logIndex("PRINT x + y.")).toBeGreaterThan(-1);
    expect(logIndex("LOCAL x IS 1.")).toBeLessThan(logIndex("LOCAL y IS 2."));
    expect(logIndex("LOCAL y IS 2.")).toBeLessThan(logIndex("PRINT x + y."));
  });

  it("emits an empty-string literal for blank body lines", () => {
    const out = buildKosWrapper({
      path: "0:/a.ks",
      body: "PRINT 1.\n\nPRINT 2.",
      version: "h",
      args: [],
    });
    expect(out).toContain(`LOG "" TO targetPath.`);
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

  it("escapes embedded double quotes via CHAR(34)", () => {
    const out = buildKosWrapper({
      path: "0:/a.ks",
      body: `PRINT "hello".`,
      version: "h",
      args: [],
    });
    // Split on `"`, each fragment quoted, joined with + CHAR(34) +.
    expect(out).toContain(
      `LOG "PRINT " + CHAR(34) + "hello" + CHAR(34) + "." TO targetPath.`,
    );
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
