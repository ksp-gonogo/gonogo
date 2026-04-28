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
  it("emits a check + RUNPATH for a single-line body", () => {
    const out = buildKosWrapper({
      path: "0:/widget_scripts/x.ks",
      body: "PRINT 1.",
      version: "v1",
      args: [],
    });
    expect(out).toContain(`LOCAL targetPath IS "0:/widget_scripts/x.ks".`);
    expect(out).toContain(`LOCAL versionPath IS "0:/widget_scripts/x.ks.ver".`);
    expect(out).toContain(`LOCAL bundledVersion IS "v1".`);
    expect(out).toContain(`IF EXISTS(targetPath) AND EXISTS(versionPath) {`);
    expect(out).toContain(`OPEN(versionPath):READALL:STRING`);
    expect(out).toContain(`LOG "PRINT 1." TO targetPath.`);
    expect(out).toContain(`LOG bundledVersion TO versionPath.`);
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
