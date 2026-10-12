// @vitest-environment node
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  copyRelease,
  planPublish,
  publish,
  pushRelease,
  tagFault,
} from "./publish";

const scratch: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const dir of scratch.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

const tmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "uplink-publish-"));
  scratch.push(dir);
  return dir;
};

const git = (dir: string, ...args: string[]) =>
  execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();

const URL =
  "https://cdn.jsdelivr.net/gh/someone/demo@releases/releases/demo/0.0.1/demo.client.js";

/** An Uplink on disk with a built client, inside a git repository with a bare origin. */
function uplink(url = URL, bundle = "export const a = 1;\n") {
  const root = tmp();
  const origin = tmp();
  execFileSync("git", ["init", "-q", "--bare", origin]);
  execFileSync("git", ["init", "-q", "-b", "main", root]);
  git(root, "remote", "add", "origin", origin);
  git(root, "config", "user.email", "a@example.com");
  git(root, "config", "user.name", "A");
  // The machine's own hooks are not under test, and an environment-supplied hooksPath beats the repository's.
  vi.stubEnv("GIT_CONFIG_COUNT", "0");
  writeFileSync(
    join(root, "uplink.json"),
    JSON.stringify({ id: "demo", client: { url } }),
  );
  mkdirSync(join(root, "client/dist/demo"), { recursive: true });
  writeFileSync(join(root, "client/package.json"), '{"version":"0.0.1"}');
  writeFileSync(join(root, "client/dist/demo/demo.client.js"), bundle);
  writeFileSync(
    join(root, "client/dist/demo/gonogo-uplink.json"),
    '{"version":"0.0.1"}',
  );
  writeFileSync(join(root, ".gitignore"), ".releases/\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return { root, origin };
}

describe("tagFault", () => {
  it("accepts <id>-v<version> at the client's version", () => {
    expect(tagFault("demo-v0.0.1", "demo", "0.0.1")).toBeUndefined();
    expect(tagFault("demo-v1.2.3-rc.1", "demo", "1.2.3-rc.1")).toBeUndefined();
  });

  it("says which of the three things is wrong", () => {
    expect(tagFault("v0.0.1", "demo", "0.0.1")).toContain("not a release tag");
    expect(tagFault("other-v0.0.1", "demo", "0.0.1")).toContain(
      "names the Uplink other",
    );
    expect(tagFault("demo-v0.0.2", "demo", "0.0.1")).toContain(
      "is for version 0.0.2",
    );
  });
});

describe("planPublish", () => {
  it("reads the ref and the path out of a jsDelivr URL", () => {
    expect(planPublish("demo", URL)).toMatchObject({
      owner: "someone",
      repo: "demo",
      ref: "releases",
      treePath: "releases/demo/0.0.1/demo.client.js",
    });
  });

  it("refuses a jsDelivr URL with no ref, which is served from the default branch", () => {
    expect(() =>
      planPublish("demo", "https://cdn.jsdelivr.net/gh/someone/demo/x.js"),
    ).toThrow(/names no @<ref>/);
  });

  it("serves any other URL from its own path", () => {
    expect(
      planPublish("demo", "https://example.com/a/demo.client.js"),
    ).toMatchObject({
      treePath: "a/demo.client.js",
    });
  });
});

describe("copyRelease", () => {
  const plan = planPublish(
    "demo",
    "https://example.com/demo/0.0.1/demo.client.js",
  );

  it("copies the bundle and the sidecar beside it, and is harmless to repeat", () => {
    const from = tmp();
    const root = tmp();
    writeFileSync(join(from, "demo.client.js"), "x");
    writeFileSync(join(from, "gonogo-uplink.json"), "{}");
    expect(copyRelease(plan, from, root).changed).toBe(true);
    expect(readFileSync(join(root, "demo/0.0.1/demo.client.js"), "utf8")).toBe(
      "x",
    );
    expect(existsSync(join(root, "demo/0.0.1/gonogo-uplink.json"))).toBe(true);
    expect(copyRelease(plan, from, root).changed).toBe(false);
  });

  it("refuses to overwrite a published version with different bytes", () => {
    const from = tmp();
    const root = tmp();
    writeFileSync(join(from, "demo.client.js"), "x");
    writeFileSync(join(from, "gonogo-uplink.json"), "{}");
    copyRelease(plan, from, root);
    writeFileSync(join(from, "demo.client.js"), "changed");
    expect(() => copyRelease(plan, from, root)).toThrow(
      /already published with different bytes/,
    );
    expect(readFileSync(join(root, "demo/0.0.1/demo.client.js"), "utf8")).toBe(
      "x",
    );
  });

  it("publishes the spec sheet beside the sidecar when the client has one", () => {
    const from = tmp();
    const root = tmp();
    const spec = join(tmp(), "spec.json");
    writeFileSync(join(from, "demo.client.js"), "x");
    writeFileSync(join(from, "gonogo-uplink.json"), "{}");
    writeFileSync(spec, '{"specVersion":1}\n');
    const result = copyRelease(plan, from, root, spec);
    expect(result.specUrl).toBe("https://example.com/demo/0.0.1/spec.json");
    expect(readFileSync(join(root, "demo/0.0.1/spec.json"), "utf8")).toBe(
      '{"specVersion":1}\n',
    );
    expect(copyRelease(plan, from, root, spec).changed).toBe(false);
  });

  it("publishes without a spec sheet for a client that has none", () => {
    const from = tmp();
    const root = tmp();
    writeFileSync(join(from, "demo.client.js"), "x");
    writeFileSync(join(from, "gonogo-uplink.json"), "{}");
    const result = copyRelease(plan, from, root, join(tmp(), "spec.json"));
    expect(result.specUrl).toBeUndefined();
    expect(existsSync(join(root, "demo/0.0.1/spec.json"))).toBe(false);
  });

  it("refuses to overwrite a published spec sheet with different bytes", () => {
    const from = tmp();
    const root = tmp();
    const spec = join(tmp(), "spec.json");
    writeFileSync(join(from, "demo.client.js"), "x");
    writeFileSync(join(from, "gonogo-uplink.json"), "{}");
    writeFileSync(spec, "one");
    copyRelease(plan, from, root, spec);
    writeFileSync(spec, "two");
    expect(() => copyRelease(plan, from, root, spec)).toThrow(
      /already published with different bytes/,
    );
  });

  it("says to release first when the client was never built", () => {
    expect(() => copyRelease(plan, tmp(), tmp())).toThrow(/Build it first/);
  });
});

describe("publish", () => {
  it("creates the releases branch, pushes it and checks the remote holds it", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { root, origin } = uplink();
    expect(await publish(["--push", "--tag", "demo-v0.0.1"], root)).toBe(0);
    expect(git(origin, "log", "--format=%s", "releases")).toBe(
      "release: demo-v0.0.1",
    );
    expect(
      git(origin, "show", "releases:releases/demo/0.0.1/demo.client.js"),
    ).toBe("export const a = 1;");
    expect(git(root, "status", "--porcelain")).toBe("");
  });

  it("reports a repeat as already published and adds no commit", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { root, origin } = uplink();
    await publish(["--push"], root);
    await publish(["--push"], root);
    expect(git(origin, "rev-list", "--count", "releases")).toBe("1");
  });

  it("pushes a release an earlier run committed and could not send, instead of calling it published", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { root, origin } = uplink();
    await publish(["--push", "--tag", "demo-v0.0.1"], root);
    const checkout = join(root, ".releases");
    // A second release is committed in the checkout, but the remote refuses it.
    writeFileSync(join(checkout, "stranded.txt"), "x");
    git(checkout, "add", "-A");
    git(checkout, "commit", "-q", "-m", "stranded");
    expect(git(origin, "rev-list", "--count", "releases")).toBe("1");
    log.mockClear();
    pushRelease(checkout, "releases", "release: demo-v0.0.1");
    expect(git(origin, "rev-list", "--count", "releases")).toBe("2");
    expect(log.mock.calls.flat().join("\n")).toContain(
      "pushing the earlier commit",
    );
  });

  it("publishes a later version beside the first and leaves the first alone", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { root, origin } = uplink();
    await publish(["--push"], root);
    writeFileSync(
      join(root, "uplink.json"),
      JSON.stringify({
        id: "demo",
        client: { url: URL.replace("0.0.1", "0.0.2") },
      }),
    );
    writeFileSync(join(root, "client/package.json"), '{"version":"0.0.2"}');
    writeFileSync(
      join(root, "client/dist/demo/demo.client.js"),
      "export const a = 2;\n",
    );
    await publish(["--push", "--tag", "demo-v0.0.2"], root);
    expect(
      git(origin, "show", "releases:releases/demo/0.0.1/demo.client.js"),
    ).toBe("export const a = 1;");
    expect(
      git(origin, "show", "releases:releases/demo/0.0.2/demo.client.js"),
    ).toBe("export const a = 2;");
  });

  it("refuses a tag for another version before touching anything", async () => {
    const { root, origin } = uplink();
    await expect(
      publish(["--push", "--tag", "demo-v9.9.9"], root),
    ).rejects.toThrow(/is for version 9.9.9/);
    expect(existsSync(join(root, ".releases"))).toBe(false);
    expect(git(origin, "branch", "--list")).toBe("");
  });

  it("refuses a folder that is not a checkout of the ref the URL names", async () => {
    const { root } = uplink();
    await expect(publish(["--to", tmp()], root)).rejects.toThrow(
      /not the root of a git checkout/,
    );
  });

  it("needs --to for a URL that names no branch", async () => {
    const { root } = uplink("https://example.com/demo/0.0.1/demo.client.js");
    await expect(publish([], root)).rejects.toThrow(/--to <dir>/);
  });
});
