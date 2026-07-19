import { describe, expect, it } from "vitest";
import { buildKosRunCommand, buildKosWrapper } from "./kosWrapper";

describe("buildKosWrapper", () => {
  it("emits SET-based check-and-rewrite at REPL top level", () => {
    const out = buildKosWrapper({
      path: "0:/widget_scripts/x.ks",
      body: "PRINT 1.",
      version: "v1",
      args: [],
    });
    expect(out).toContain(
      `SET gonogoWrapperTarget TO "0:/widget_scripts/x.ks".`,
    );
    expect(out).toContain(
      `SET gonogoWrapperVerPath TO "0:/widget_scripts/x.ks.ver".`,
    );
    expect(out).toContain(`SET gonogoWrapperVersion TO "v1".`);
    expect(out).toContain(`SET gonogoWrapperBody TO "PRINT 1.".`);
    expect(out).toContain(`SET gonogoWrapperNeedsWrite TO TRUE.`);
    expect(out).toContain(
      `IF EXISTS(gonogoWrapperTarget) AND EXISTS(gonogoWrapperVerPath) {`,
    );
    expect(out).toContain(
      `OPEN(gonogoWrapperVerPath):READALL:STRING:TRIM = gonogoWrapperVersion`,
    );
    expect(out).toContain(`SET gonogoWrapperNeedsWrite TO FALSE.`);
    expect(out).toContain(`LOG gonogoWrapperBody TO gonogoWrapperTarget.`);
    expect(out).toContain(`LOG gonogoWrapperVersion TO gonogoWrapperVerPath.`);
    expect(out).toContain(`RUNPATH("0:/widget_scripts/x.ks").`);
    // No FUNCTION wrapping — the previous attempt got bitten by REPL
    // function caching when the parameter list changed.
    expect(out).not.toContain(`FUNCTION gonogoWrapperEnsure`);
  });

  it("joins body lines with CHAR(10) so a multi-line body is one LOG call", () => {
    const out = buildKosWrapper({
      path: "0:/a.ks",
      body: "LOCAL x IS 1.\nLOCAL y IS 2.\nPRINT x + y.",
      version: "h",
      args: [],
    });
    const matches =
      out.match(/LOG gonogoWrapperBody TO gonogoWrapperTarget\./g) ?? [];
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

  it("orders SET assignments before RUNPATH (REPL processes in order)", () => {
    const out = buildKosWrapper({
      path: "0:/a.ks",
      body: "PRINT 1.",
      version: "v",
      args: [],
    });
    const setIdx = out.indexOf(`SET gonogoWrapperTarget`);
    const runIdx = out.indexOf(`RUNPATH(`);
    expect(setIdx).toBeGreaterThanOrEqual(0);
    expect(runIdx).toBeGreaterThan(setIdx);
  });

  it("escapes embedded double quotes via CHAR(34) inside the body assignment", () => {
    const out = buildKosWrapper({
      path: "0:/a.ks",
      body: `PRINT "hello".`,
      version: "h",
      args: [],
    });
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

  it("fragments topic-tagged [KOSDATA:topic] sentinels — the parser regex matches both forms", () => {
    const out = buildKosWrapper({
      path: "0:/a.ks",
      body: `PRINT "[KOSDATA:my-topic]value=" + value + "[/KOSDATA]".`,
      version: "h",
      args: [],
    });
    // The wrapper text must not contain a contiguous `[KOSDATA:my-topic]`
    // anywhere — leaving the open marker intact pairs with a later
    // `[/KOSDATA]` from the real script's PRINT and the lazy regex
    // captures the wrapper source as the payload.
    expect(out).not.toContain("[KOSDATA:my-topic]");
    expect(out).not.toContain("[/KOSDATA]");
    expect(out).toContain(`"[" + "KOSDATA:my-topic]value="`);
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

describe("buildKosRunCommand", () => {
  it("builds a bare RUNPATH when managed is null — same text as before extraction", () => {
    const cmd = buildKosRunCommand("0:/foo.ks", [1.5, true, "hi"], null);
    expect(cmd).toBe('RUNPATH("0:/foo.ks", 1.5, true, "hi").\n');
  });

  it("escapes a quote in a bare string arg by doubling it (not CHAR(34))", () => {
    const cmd = buildKosRunCommand("0:/foo.ks", [`a"b`], null);
    expect(cmd).toBe('RUNPATH("0:/foo.ks", "a""b").\n');
  });

  it("delegates to buildKosWrapper when managed is supplied", () => {
    const cmd = buildKosRunCommand("0:/widget_scripts/x.ks", [], {
      body: "PRINT 1.",
      version: "v1",
    });
    expect(cmd).toBe(
      buildKosWrapper({
        path: "0:/widget_scripts/x.ks",
        body: "PRINT 1.",
        version: "v1",
        args: [],
      }),
    );
  });
});
