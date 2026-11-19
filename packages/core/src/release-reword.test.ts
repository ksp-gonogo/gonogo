// @vitest-environment node
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildChangelog,
  plainSections,
  rangeForUnreleased,
} from "../../../scripts/release-changelog.mjs";
import type { RewordTable } from "../../../scripts/release-reword.mjs";
import {
  applyTable,
  readParsers,
  subjectProblems,
  widgetNames,
} from "../../../scripts/release-reword.mjs";

/**
 * The release reword table: literal ops keyed by full sha, applied to
 * git-cliff's context and rendered by the same template. Held against a
 * synthetic history built here, run through the real git-cliff, so no real
 * sha or subject from this repository appears in a fixture.
 */

/* Spelled in two halves so this file does not itself carry a tracker word. */
const SAGA = ["Sa", "ga"].join("");
const DECISION = ["deci", "sion"].join("");

const ROOT = join(__dirname, "../../..");
const CONFIG = join(ROOT, "cliff.toml");
const parsers = readParsers(readFileSync(CONFIG, "utf8"));

let repo: string;
const shas: Record<string, string> = {};

const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();

const commit = (key: string, subject: string) => {
  writeFileSync(join(repo, "f.txt"), `${subject}\n${key}`);
  git("add", "-A");
  git("commit", "-q", "-m", subject);
  shas[key] = git("rev-parse", "HEAD");
};

const SUBJECTS: Record<string, string> = {
  replay: "feat(app): replay plays a recorded flight on a timeline",
  modes: "feat(modes): every mode can add sections and a timeline",
  blackout: "fix(comms): a forced blackout clears the path readings",
  press: "fix(commands): a press after a switch reaches the craft",
  press2: "fix(commands): a toggle says why it is unread",
  solve: "perf(widgets): the planner stops solving every frame",
  tidy: "refactor(commcast): tidy the relay",
  tool: "feat(uplink-tools): package ships module patches",
  wire: "fix(wire): a command reply keeps its full contents on the wire",
  hook: "feat(sdk): useScreenName names a screen",
  reply: "fix(mod): the host writes a contract class in a reply",
  ci: "ci(mod): build the probe harness",
  tests: "test(rig): a test",
};

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "reword-table-"));
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  commit("base", "feat(app): an earlier feature");
  git("tag", "v1.0.0");
  for (const [key, subject] of Object.entries(SUBJECTS)) commit(key, subject);
}, 60_000);

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

const range = () => rangeForUnreleased(repo);
const table = (ops: Record<string, unknown>): RewordTable => ({
  version: 1,
  release: "1.1.0",
  ops: ops as RewordTable["ops"],
});
const render = (ops?: Record<string, unknown>) =>
  buildChangelog({
    range: range(),
    cwd: repo,
    config: CONFIG,
    table: ops ? table(ops) : undefined,
  });

describe("the layout", () => {
  it("splits App, Uplinks and API, folds the last two, and leaves out ci, test and refactor", () => {
    const text = render();
    expect(text).toMatch(/^\s*## App\n\n### Features\n/);
    expect(text).toContain("- Replay plays a recorded flight on a timeline");
    expect(text).toContain("### Bug fixes");
    expect(text).toContain("### Performance");
    expect(text).toContain(
      "<summary><strong>Uplinks</strong>, and building them (3 changes)</summary>",
    );
    expect(text).toContain(
      "<summary><strong>API</strong>, the mod's own interface (1 change)</summary>",
    );
    expect(text.indexOf("## App")).toBeLessThan(text.indexOf("Uplinks"));
    expect(text.indexOf("Uplinks")).toBeLessThan(text.indexOf("<strong>API"));
    expect(text).not.toMatch(/tidy the relay|probe harness|a test/);
  });

  it("puts sdk, ui-kit, uplink-tools, mod and uplinks in Uplinks and contract and wire in API", () => {
    const text = render();
    const uplinks = text.slice(
      text.indexOf("<strong>Uplinks"),
      text.indexOf("<strong>API"),
    );
    expect(uplinks).toContain("uplink-tools: package ships module patches");
    expect(uplinks).toContain("sdk: useScreenName names a screen");
    expect(uplinks).toContain("The host writes a contract class in a reply");
    const api = text.slice(text.indexOf("<strong>API"));
    expect(api).toContain(
      "A command reply keeps its full contents on the wire",
    );
    expect(api).not.toContain("useScreenName");
  });

  it("leaves a section with no lines out entirely", () => {
    const text = render({ [shas.wire]: { op: "drop" } });
    expect(text).not.toContain("API");
    expect(text).toContain("<strong>Uplinks</strong>");
  });

  it("turns the folded sections into plain headings for SpaceDock", () => {
    const plain = plainSections(render());
    expect(plain).not.toMatch(/<\/?(details|summary|strong)>/);
    expect(plain).toMatch(/^## Uplinks, and building them \(3 changes\)$/m);
    expect(plain).toMatch(/^## API, the mod's own interface \(1 change\)$/m);
    expect(plain.indexOf("## App")).toBeLessThan(plain.indexOf("## Uplinks"));
  });
});

describe("what each destination receives", () => {
  const CLI = join(ROOT, "scripts/release-changelog.mjs");
  const TAGS = /<\/?(details|summary|strong)\b/i;
  const cli = (...args: string[]) => {
    const out = join(repo, "cli-out.md");
    const r = spawnSync("node", [CLI, ...args, "--out", out], {
      cwd: repo,
      encoding: "utf8",
    });
    expect(r.status, r.stderr).toBe(0);
    return readFileSync(out, "utf8");
  };

  it("keeps the folded sections on the GitHub Release and none on SpaceDock, at every cap", () => {
    const release = join(repo, "release-body.md");
    writeFileSync(release, render());
    expect(readFileSync(release, "utf8")).toMatch(/<details>/);
    for (const cap of ["16000", "900", "400", "200"]) {
      const spacedock = cli(
        "--from",
        release,
        "--plain",
        "--max-bytes",
        cap,
        "--link",
        "https://example.com/releases/tag/1.1.0",
      );
      expect(spacedock, `cap ${cap}`).not.toMatch(TAGS);
      expect(Buffer.byteLength(spacedock)).toBeLessThanOrEqual(Number(cap));
    }
    const spacedock = cli("--from", release, "--plain");
    expect(spacedock).toContain("## Uplinks, and building them (3 changes)");
  });

  it("gives SpaceDock no tags when the notes were generated straight from the commits", () => {
    const direct = cli("--range", range(), "--plain");
    expect(direct).not.toMatch(TAGS);
    expect(direct).toContain("## App");
  });
});

describe("applying a table", () => {
  const ops = () => ({
    [shas.blackout]: {
      op: "reword",
      subject: "fix(comms): a comms blackout also clears the path readings",
    },
    [shas.press2]: {
      op: "absorb",
      into: shas.press,
      subject:
        "fix(commands): a press after a craft switch reaches the new craft",
    },
    [shas.hook]: { op: "drop" },
    [shas.modes]: {
      op: "split",
      lines: [
        "feat(app): plan a flight in the vehicle editor with Flight Plan",
        "feat(app): follow the plan against the craft once it flies",
      ],
    },
    [shas.tidy]: {
      op: "reword",
      subject: "perf(commcast): the relay stops recalculating every frame",
    },
  });

  it("drops, rewords, absorbs, splits and promotes a refactor", () => {
    const text = render(ops());
    expect(text).toContain("A comms blackout also clears the path readings");
    expect(text).not.toContain("forced blackout");
    expect(text).toContain(
      "A press after a craft switch reaches the new craft",
    );
    expect(text).not.toContain("a toggle says why");
    expect(text).not.toContain("press after a switch");
    expect(text).not.toContain("UseScreenName");
    expect(text).toContain("Plan a flight in the vehicle editor");
    expect(text).toContain("Follow the plan against the craft");
    expect(text).not.toContain("every mode can add sections");
    expect(text).toMatch(
      /### Performance\n\n- (The relay stops recalculating every frame|The planner stops solving every frame)/,
    );
    expect(text).toContain("The relay stops recalculating every frame");
    expect(text).toContain(
      "<summary><strong>Uplinks</strong>, and building them (2 changes)</summary>",
    );
  });

  it("gives the same output twice for the same table", () => {
    expect(render(ops())).toBe(render(ops()));
  });

  it("matches the plain render when the table has no ops", () => {
    expect(render({})).toBe(render());
  });
});

describe("faults the table is refused for", () => {
  const releases = [
    {
      commits: ["a", "b", "c"].map((n) => ({
        id: n.repeat(40),
        message: n,
        group: "App/Features",
        raw_message: `feat(app): ${n}`,
      })),
    },
  ];
  const A = "a".repeat(40);
  const B = "b".repeat(40);
  const C = "c".repeat(40);
  const OUT = "d".repeat(40);
  const inRange = [A, B, C];
  const apply = (ops: Record<string, unknown>) =>
    applyTable(releases, table(ops), inRange, parsers);

  it("fails on a sha outside the release range", () => {
    expect(() => apply({ [OUT]: { op: "drop" } })).toThrow(
      /outside the release range/,
    );
  });

  it("fails on an absorb target outside the release", () => {
    expect(() => apply({ [A]: { op: "absorb", into: OUT } })).toThrow(
      /target .* is outside the release/,
    );
  });

  it("fails on an absorb into a dropped commit", () => {
    expect(() =>
      apply({ [A]: { op: "absorb", into: B }, [B]: { op: "drop" } }),
    ).toThrow(/chain or cycle/);
  });

  it("fails on an absorb chain", () => {
    expect(() =>
      apply({
        [A]: { op: "absorb", into: B },
        [B]: { op: "absorb", into: C },
      }),
    ).toThrow(/chain or cycle/);
  });

  it("fails on an absorb cycle", () => {
    expect(() =>
      apply({
        [A]: { op: "absorb", into: B },
        [B]: { op: "absorb", into: A },
      }),
    ).toThrow(/chain or cycle/);
  });

  it("lets an absorb into a split target stand, the split lines kept", () => {
    const out = apply({
      [A]: { op: "absorb", into: B },
      [B]: {
        op: "split",
        lines: ["feat(app): first line", "feat(app): second line"],
      },
    });
    expect(out[0].commits.map((c) => c.message)).toEqual([
      "first line",
      "second line",
      "c",
    ]);
  });

  it("fails on an absorb with a subject into a split target", () => {
    expect(() =>
      apply({
        [A]: { op: "absorb", into: B, subject: "fix(app): a new subject" },
        [B]: {
          op: "split",
          lines: ["feat(app): first line", "feat(app): second line"],
        },
      }),
    ).toThrow(/is split, so the absorb cannot give it a subject/);
  });

  it("fails on a reword that is not a Conventional Commit", () => {
    expect(() =>
      apply({ [A]: { op: "reword", subject: "a plain sentence" } }),
    ).toThrow(/not a Conventional Commit/);
  });

  it("fails on a reword over 100 characters", () => {
    expect(() =>
      apply({ [A]: { op: "reword", subject: `fix(app): ${"x".repeat(100)}` } }),
    ).toThrow(/characters \(the limit is 100\)/);
  });

  it("fails on a reword that names a ticket", () => {
    expect(() =>
      apply({ [A]: { op: "reword", subject: "fix(app): closes #12" } }),
    ).toThrow(/tracker ticket/);
    expect(() =>
      apply({ [A]: { op: "reword", subject: `fix(app): see ${DECISION} 4` } }),
    ).toThrow(/tracker ticket/);
  });

  it("fails on a reword with an em or en dash", () => {
    for (const dash of ["\u2014", "\u2013"])
      expect(() =>
        apply({ [A]: { op: "reword", subject: `fix(app): a${dash}b` } }),
      ).toThrow(/em dash or an en dash/);
    expect(() =>
      apply({ [A]: { op: "reword", subject: "fix(app): a-b is fine" } }),
    ).not.toThrow();
  });

  describe("an article before a widget name", () => {
    const widget = widgetNames()[0];

    it("reads core's widgets and the bundled Uplinks' from their registrations", () => {
      const names = widgetNames();
      expect(names).toContain("Ground Track");
      expect(names).toContain("Rotor Tachometer");
    });

    it("fails on a reword that puts an article before one", () => {
      for (const article of ["the", "a", "an", "The"])
        expect(() =>
          apply({
            [A]: {
              op: "reword",
              subject: `fix(app): ${article} ${widget} opens`,
            },
          }),
        ).toThrow(/before the widget name/);
    });

    it("fails on a split line that does", () => {
      expect(() =>
        apply({
          [A]: {
            op: "split",
            lines: ["feat(app): fine", `feat(app): open the ${widget}`],
          },
        }),
      ).toThrow(/split line 2: the subject puts "the" before the widget name/);
    });

    it("fails on an absorb subject that does", () => {
      expect(() =>
        apply({
          [B]: {
            op: "absorb",
            into: A,
            subject: `fix(app): an ${widget} opens`,
          },
        }),
      ).toThrow(/absorb subject: the subject puts "an" before/);
    });

    it("passes the bare name and an article in plain prose", () => {
      expect(() =>
        apply({
          [A]: {
            op: "reword",
            subject: `fix(app): ${widget} opens at the top`,
          },
        }),
      ).not.toThrow();
    });
  });

  it("fails on a split line that breaks the rules", () => {
    expect(() =>
      apply({
        [A]: { op: "split", lines: ["feat(app): fine", "not conventional"] },
      }),
    ).toThrow(/split line 2/);
  });

  it("fails on a reword into a type cliff.toml leaves out", () => {
    expect(() =>
      apply({ [A]: { op: "reword", subject: "ci(app): quiet" } }),
    ).toThrow(/left out of the changelog/);
  });

  it("fails loudly on a sha the changelog does not hold, never skipping it", () => {
    const limited = applyTable.bind(null, releases);
    expect(() =>
      limited(table({ [OUT]: { op: "drop" } }), [A, B, C, OUT], parsers),
    ).toThrow(/not in the changelog/);
  });

  it("refuses a short sha and an unknown op", () => {
    expect(() => apply({ abc1234: { op: "drop" } })).toThrow(/full 40-hex/);
    expect(() => apply({ [A]: { op: "squash" } })).toThrow(/unknown op/);
  });

  it("refuses a table through the real script and writes nothing", () => {
    const tablePath = join(repo, "..", `bad-${process.pid}.json`);
    writeFileSync(tablePath, JSON.stringify(table({ [OUT]: { op: "drop" } })));
    const outPath = join(repo, "..", `out-${process.pid}.md`);
    try {
      const run = spawnSync(
        "node",
        [
          join(ROOT, "scripts/release-changelog.mjs"),
          "--out",
          outPath,
          "--table",
          tablePath,
          "--release",
          "1.1.0",
        ],
        { cwd: repo, encoding: "utf8" },
      );
      expect(run.status).not.toBe(0);
      expect(run.stderr).toMatch(/outside the release range/);
      expect(() => readFileSync(outPath)).toThrow();
    } finally {
      rmSync(tablePath, { force: true });
    }
  });
});

describe("the subject rules match .githooks/commit-msg", () => {
  const hookAccepts = (subject: string) => {
    const message = join(repo, "..", `msg-${process.pid}`);
    writeFileSync(message, `${subject}\n`);
    try {
      return (
        spawnSync("bash", [join(ROOT, ".githooks/commit-msg"), message], {
          cwd: repo,
          encoding: "utf8",
        }).status === 0
      );
    } finally {
      rmSync(message, { force: true });
    }
  };

  it.each([
    ["feat(app): a fine line"],
    ["fix: no scope"],
    ["perf(widgets)!: breaking"],
    ["a plain sentence"],
    ["feat(app):"],
    [`fix(app): ${"x".repeat(100)}`],
    ["fix(app): closes #12"],
    [`fix(app): ${SAGA} work`],
    ["fix(app): batch 2 of it"],
    [`fix(app): per ${DECISION} 9`],
    ["Fix(app): capital type"],
    ["feat(a space): scope with a space"],
  ])("agrees on %s", (subject) => {
    expect(subjectProblems(subject).length === 0).toBe(hookAccepts(subject));
  });
});
