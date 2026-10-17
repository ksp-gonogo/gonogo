import { describe, expect, it } from "vitest";
import {
  buildIssueLink,
  ISSUE_URL_LIMIT,
  type IssueFields,
  redactLogLine,
} from "./githubIssue";

const fields: IssueFields = {
  description: "The map goes blank after a scene change",
  modVersion: "v1.4.0",
  appVersion: "1.4.0",
  uplinks: ["sample 1.2.0", "example 0.9.1"],
  screen: "Main screen",
};

const lines = (n: number) =>
  Array.from({ length: n }, (_, i) => `line ${i} ${"x".repeat(60)}`);

describe("redactLogLine", () => {
  it.each([
    [
      `loaded /${"Users"}/jon/Games/KSP/GameData/Gonogo/Plugins/a.dll`,
      "/Users",
    ],
    ["read C:\\Program Files\\KSP\\KSP.log", "C:\\"],
    [`connected to ${"192.168"}.1.20:8090`, "192.168"],
    ["hosting as host XK3F", "XK3F"],
    ["peer station-abc123-def456 joined", "abc123"],
  ])("removes the identifying part of %s", (line, leaked) => {
    expect(redactLogLine(line)).not.toContain(leaked);
  });

  it("leaves an ordinary line alone", () => {
    expect(redactLogLine("[Gonogo] Started")).toBe("[Gonogo] Started");
  });
});

describe("buildIssueLink", () => {
  it("carries the description and the versions in the body", () => {
    const { url } = buildIssueLink(fields, []);
    const q = new URL(url).searchParams;
    expect(q.has("template")).toBe(false);
    expect(q.get("labels")).toBe("bug");
    const body = q.get("body") ?? "";
    expect(body).toContain(fields.description);
    expect(body).toContain("Mod version: v1.4.0");
    expect(body).toContain("App version: 1.4.0");
    expect(body).toContain("Installed Uplinks: sample 1.2.0, example 0.9.1");
    expect(body).toContain("Screen: Main screen");
    expect(body).not.toContain("## Logs");
  });

  it("puts a short log in a collapsed section", () => {
    const link = buildIssueLink(fields, [
      { title: "KSP.log", lines: lines(5) },
    ]);
    expect(link.log).toBe("all");
    expect(link.clipboard).toBeNull();
    expect(new URL(link.url).searchParams.get("body")).toContain("<details>");
  });

  it("drops the oldest lines first and copies the whole log", () => {
    const all = lines(400);
    const link = buildIssueLink(fields, [{ title: "KSP.log", lines: all }]);
    expect(link.log).toBe("trimmed");
    expect(link.url.length).toBeLessThanOrEqual(ISSUE_URL_LIMIT);
    const logs = new URL(link.url).searchParams.get("body") ?? "";
    expect(logs).toContain("line 399");
    expect(logs).not.toContain("line 0 ");
    expect(link.clipboard).toBe(`KSP.log\n${all.join("\n")}`);
  });

  it("sends no log when even a few lines will not fit", () => {
    const link = buildIssueLink(
      fields,
      [{ title: "KSP.log", lines: lines(50) }],
      600,
    );
    expect(link.log).toBe("none");
    expect(link.url.length).toBeLessThanOrEqual(600);
    expect(link.clipboard).toContain("line 0 ");
  });

  it("drops a later section whole before trimming the first", () => {
    const mod = { title: "KSP.log", lines: lines(20) };
    const app = { title: "App log", lines: lines(200) };
    const link = buildIssueLink(fields, [mod, app]);
    expect(link.log).toBe("trimmed");
    const logs = new URL(link.url).searchParams.get("body") ?? "";
    expect(logs).toContain("KSP.log (20 lines)");
    expect(logs).not.toContain("App log");
    expect(link.clipboard).toContain("App log");
  });

  it("keeps both sections when they fit", () => {
    const link = buildIssueLink(fields, [
      { title: "KSP.log", lines: lines(3) },
      { title: "App log", lines: lines(3) },
    ]);
    expect(link.log).toBe("all");
    expect(new URL(link.url).searchParams.get("body")).toContain("App log");
  });
});
