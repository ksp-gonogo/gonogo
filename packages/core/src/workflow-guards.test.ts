// @vitest-environment node
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guards inside the release-path workflows that no run exercises until a
 * release goes wrong: each assertion fails if the guard it names is deleted.
 */

function findRepoRoot(start: string): string {
  let dir = start;
  while (dir !== "/") {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`Could not locate workspace root from ${start}`);
}

const ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
/** A GitHub Actions expression, spelled out of parts so the literal is not mistaken for a template. */
const expr = (inner: string) => `\${{ ${inner} }}`;
const workflow = (name: string) =>
  readFileSync(join(ROOT, ".github/workflows", name), "utf8");

function jobBlock(text: string, name: string): string {
  const start = text.indexOf(`\n  ${name}:\n`);
  expect(start, `the ${name} job`).toBeGreaterThan(-1);
  const next = text.slice(start + 1).search(/\n {2}[a-z-]+:\n/);
  return text.slice(start, next === -1 ? undefined : start + 1 + next);
}

describe("ci-dev-forward.yml", () => {
  const forward = workflow("ci-dev-forward.yml");
  const job = jobBlock(forward, "forward");

  it("forwards only a green push run of this repository's own commit", () => {
    expect(job).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(job).toContain("github.event.workflow_run.event == 'push'");
    expect(job).toContain(
      "github.event.workflow_run.head_repository.full_name == github.repository",
    );
  });

  it("runs the verdict script from staging, never from the commit under test", () => {
    expect(job).toMatch(
      /ref: staging\n\s+path: trusted\n[\s\S]*scripts\/ci-dev-forward-verdict\.sh/,
    );
    expect(job).toContain("bash trusted/scripts/ci-dev-forward-verdict.sh");
    expect(job).not.toMatch(/bash scripts\/ci-dev-forward-verdict\.sh/);
  });
});

describe("publish-images.yml", () => {
  const images = workflow("publish-images.yml");

  it("publishes the release channel from a release tag whose number is the app's", () => {
    const plan = jobBlock(images, "plan");
    expect(plan).toMatch(
      /if: \$\{\{ env\.CHANNEL == 'release' \}\}\n\s+run: node scripts\/mod-release-tag\.mjs assert "\$\{GITHUB_REF_NAME\}"/,
    );
    expect(plan).toMatch(
      /\[ "v\$\{VERSION\}" != "\$\{GITHUB_REF_NAME\}" \][\s\S]*exit 1/,
    );
  });

  it("builds and tags the commit the plan resolved, by short sha", () => {
    const plan = jobBlock(images, "plan");
    expect(plan).toContain(`ref: ${expr("inputs.ref || github.sha")}`);
    expect(plan).toContain('echo "sha=$(git rev-parse HEAD)"');
    for (const name of ["publish", "publish-bundle"]) {
      expect(jobBlock(images, name), name).toContain(
        `ref: ${expr("needs.plan.outputs.sha")}`,
      );
    }
    const tag = jobBlock(images, "tag");
    expect(tag).toContain(`SHA: ${expr("needs.plan.outputs.sha")}`);
    expect(tag).toMatch(/tags=\("sha-\$\{SHA:0:7\}"\)/);
  });

  it("pushes both images by digest and tags them only once both exist", () => {
    for (const name of ["publish", "publish-bundle"]) {
      expect(jobBlock(images, name), name).toContain("push-by-digest=true");
    }
    const tag = jobBlock(images, "tag");
    expect(tag).toMatch(/needs: \[plan, publish, publish-bundle\]/);
    expect(tag).toContain("docker buildx imagetools create");
  });

  it("moves latest only for the newest stable release tag", () => {
    const tag = jobBlock(images, "tag");
    expect(tag).toContain("sort -V | tail -n 1");
    expect(tag).toMatch(
      /if \[ "v\$\{VERSION\}" = "\$newest" \]; then\n\s+tags\+=\("latest"\)/,
    );
    expect(tag).not.toMatch(/tags\+=\("\$VERSION" "latest"\)/);
  });
});

describe("the SpaceDock reply check in _build-uplink-mod.yml", () => {
  const text = workflow("_build-uplink-mod.yml");
  const start = text.indexOf("          spacedock() {\n");
  expect(start, "the spacedock helper").toBeGreaterThan(-1);
  const end = text.indexOf("\n          }\n", start);
  const helper = text
    .slice(start, end + "\n          }\n".length)
    .split("\n")
    .map((line) => line.slice(10))
    .join("\n");

  /** Runs the workflow's own helper against a curl that answers `code` and `body`. */
  function run(code: string, body: string): { ok: boolean; output: string } {
    const dir = mkdtempSync(join(tmpdir(), "spacedock-"));
    const script = join(dir, "run.sh");
    writeFileSync(
      script,
      `${helper}
curl() {
  local out=""
  while [ $# -gt 0 ]; do
    if [ "$1" = "-o" ]; then out="$2"; shift; fi
    shift
  done
  printf '%s' "$BODY" > "$out"
  printf '%s' "$CODE"
}
spacedock "${dir}/reply.json" https://spacedock.invalid/api/login
`,
    );
    const r = spawnSync("bash", [script], {
      env: { ...process.env, CODE: code, BODY: body },
      encoding: "utf8",
    });
    return { ok: r.status === 0, output: `${r.stdout}${r.stderr}` };
  }

  it("accepts a 2xx reply carrying a JSON object", () => {
    expect(run("200", '{"id": 4}').ok).toBe(true);
    expect(run("200", '{"error": false}').ok).toBe(true);
  });

  it("refuses a non-2xx status even when the body looks fine", () => {
    const r = run("403", '{"id": 4}');
    expect(r.ok).toBe(false);
    expect(r.output).toContain("HTTP 403");
  });

  it("refuses a 2xx reply flagged as an error", () => {
    expect(run("200", '{"error": true, "reason": "no"}').ok).toBe(false);
  });

  it("refuses a 2xx reply that is not a JSON object", () => {
    expect(run("200", "<html>maintenance</html>").ok).toBe(false);
    expect(run("200", "[1]").ok).toBe(false);
  });
});

describe("release.yml dry runs", () => {
  const text = workflow("release.yml");

  it("never run the app release, so they cannot ship or tag anything", () => {
    const condition = jobBlock(text, "release")
      .split("\n")
      .find((line) => line.startsWith("    if:"));
    expect(condition).toMatch(
      /!\(github\.event_name == 'workflow_dispatch' && \(inputs\.packages_only \|\| inputs\.rc \|\| inputs\.dry_run\)\)/,
    );
  });
});
