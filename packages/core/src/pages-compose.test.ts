import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  API_PAGE_PATHS,
  compose,
  OWNED_PATHS,
  redirectPage,
} from "../../../scripts/pages-compose.mjs";

/**
 * The organisation site is one repository shared by the landing page, the
 * release app and the RC app. `deploy.yml` writes one channel
 * into it per run, so what this holds is that a channel's run leaves every
 * other tenant's files exactly as they were, and that the redirects from the
 * old project-page URLs keep the state a station link carries.
 */

let work: string;
let dist: string;
let api: string;
let site: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "pages-compose-"));
  dist = join(work, "dist");
  api = join(work, "api");
  site = join(work, "site");
  mkdirSync(api);
  writeFileSync(join(api, "index.html"), "<html>API PAGE</html>");
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(join(dist, "index.html"), "<html>NEW APP</html>");
  writeFileSync(join(dist, "assets", "_chunk.js"), "new");

  // A site that already holds every tenant, each with a file the next deploy must not carry over or disturb.
  for (const dir of ["rc/assets", "app/assets", "other/guide", "gonogo/dev"])
    mkdirSync(join(site, dir), { recursive: true });
  writeFileSync(join(site, "rc", "index.html"), "OLD RC");
  writeFileSync(join(site, "rc", "assets", "stale.js"), "old");
  writeFileSync(join(site, "app", "index.html"), "OLD APP");
  writeFileSync(join(site, "app", "assets", "stale.js"), "old");
  writeFileSync(join(site, "other", "guide", "index.html"), "OTHER");
  writeFileSync(join(site, "gonogo", "dev", "index.html"), "OLD DEV");
  writeFileSync(join(site, "index.html"), "OLD LANDING");
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

function read(...path: string[]): string {
  return readFileSync(join(site, ...path), "utf8");
}

describe("the rc channel", () => {
  it("replaces /rc/ whole, with each client-side route as a real file", () => {
    compose("rc", dist, api, site);

    expect(read("rc", "index.html")).toBe("<html>NEW APP</html>");
    expect(read("rc", "station", "index.html")).toBe("<html>NEW APP</html>");
    expect(read("rc", "pilot", "index.html")).toBe("<html>NEW APP</html>");
    expect(read("rc", "assets", "_chunk.js")).toBe("new");
    expect(existsSync(join(site, "rc", "assets", "stale.js"))).toBe(false);
  });

  it("puts the API page of its own contract at /rc/api/", () => {
    compose("rc", dist, api, site);

    expect(API_PAGE_PATHS.rc).toBe("rc/api");
    expect(read("rc", "api", "index.html")).toBe("<html>API PAGE</html>");
    expect(existsSync(join(site, "gonogo", "api"))).toBe(false);
  });

  it("touches nothing outside /rc/ but the empty Jekyll marker", () => {
    compose("rc", dist, api, site);

    expect(read("app", "index.html")).toBe("OLD APP");
    expect(read("app", "assets", "stale.js")).toBe("old");
    expect(read("other", "guide", "index.html")).toBe("OTHER");
    expect(read("gonogo", "dev", "index.html")).toBe("OLD DEV");
    expect(read("index.html")).toBe("OLD LANDING");
    expect(read(".nojekyll")).toBe("");
    expect(readdirSync(site).sort()).toEqual(
      [".nojekyll", "app", "gonogo", "index.html", "other", "rc"].sort(),
    );
  });
});

describe("the rc channel before the first release", () => {
  beforeEach(() => {
    rmSync(join(site, "app"), { recursive: true, force: true });
  });

  it("shows the landing page at the root with its app link pointing at /rc/", () => {
    compose("rc", dist, api, site);

    expect(read("index.html")).toContain('<code id="run-command">');
    expect(read("index.html")).toContain("ksp-gonogo.github.io/rc/station");
    expect(read("index.html")).not.toContain("ksp-gonogo.github.io/app/");
  });

  it("sends the old /gonogo/ URLs to /rc/, keeping the station routes", () => {
    compose("rc", dist, api, site);

    expect(read("gonogo", "index.html")).toContain('href="/rc/"');
    expect(read("gonogo", "station", "index.html")).toContain(
      'href="/rc/station"',
    );
    expect(existsSync(join(site, "gonogo", "dev"))).toBe(false);
    expect(read("404.html")).toContain("location.replace");
    expect(existsSync(join(site, "app"))).toBe(false);
  });

  it("writes only the paths it says it owns, which is the list deploy.yml stages", () => {
    compose("rc", dist, api, site);

    expect(readdirSync(site).sort()).toEqual(
      [...OWNED_PATHS.rc, "other"].sort(),
    );
  });

  it("puts the API page at /gonogo/api/ beside the redirects it writes", () => {
    compose("rc", dist, api, site);

    expect(read("gonogo", "api", "index.html")).toBe("<html>API PAGE</html>");
    expect(read("rc", "api", "index.html")).toBe("<html>API PAGE</html>");
  });
});

describe("the rc channel once a release exists", () => {
  it("leaves the landing page, the 404 page and /gonogo/ to the release channel", () => {
    writeFileSync(join(site, "404.html"), "RELEASE 404");
    compose("release", dist, api, site);
    const before = [
      read("index.html"),
      read("404.html"),
      read("gonogo", "index.html"),
    ];

    compose("rc", dist, api, site);

    expect([
      read("index.html"),
      read("404.html"),
      read("gonogo", "index.html"),
    ]).toEqual(before);
    expect(read("index.html")).toContain("ksp-gonogo.github.io/app/station");
    expect(read("gonogo", "index.html")).toContain('href="/app/"');
  });
});

describe("the release channel", () => {
  it("writes the app to /app/, the landing page to the root, and the README beside it", () => {
    compose("release", dist, api, site);

    expect(read("app", "index.html")).toBe("<html>NEW APP</html>");
    expect(read("app", "station", "index.html")).toBe("<html>NEW APP</html>");
    expect(read("app", "pilot", "index.html")).toBe("<html>NEW APP</html>");
    expect(existsSync(join(site, "app", "assets", "stale.js"))).toBe(false);
    expect(read("index.html")).toContain('<code id="run-command">');
    expect(read(".nojekyll")).toBe("");
    expect(read("README.md")).toBe(
      "[ksp-gonogo/gonogo](https://github.com/ksp-gonogo/gonogo)\n",
    );
  });

  it("puts the API page at /gonogo/api/ beside the redirects, which still answer the old app routes", () => {
    compose("release", dist, api, site);

    expect(API_PAGE_PATHS.root).toBe("gonogo/api");
    expect(read("gonogo", "api", "index.html")).toBe("<html>API PAGE</html>");
    expect(read("gonogo", "index.html")).toContain("location.replace");
    expect(read("rc", "index.html")).toBe("OLD RC");
  });

  it("refuses to publish without an API page", () => {
    rmSync(join(api, "index.html"));
    expect(() => compose("release", dist, api, site)).toThrow(/api-page/);
  });

  it("keeps a README that is already there, so it is written once", () => {
    writeFileSync(join(site, "README.md"), "KEPT");
    compose("release", dist, api, site);

    expect(read("README.md")).toBe("KEPT");
  });

  it("never deletes or changes /rc/ or a path it does not own", () => {
    compose("release", dist, api, site);

    expect(read("rc", "index.html")).toBe("OLD RC");
    expect(read("rc", "assets", "stale.js")).toBe("old");
    expect(read("other", "guide", "index.html")).toBe("OTHER");
  });

  it("writes only the paths it says it owns, which is the list deploy.yml stages", () => {
    compose("release", dist, api, site);

    const untouched = ["rc", "other"];
    expect(readdirSync(site).sort()).toEqual(
      [...OWNED_PATHS.release, ...untouched].sort(),
    );
  });

  it("puts a redirect at every old URL and clears what the old site left under /gonogo/", () => {
    compose("release", dist, api, site);

    for (const old of [
      ["gonogo"],
      ["gonogo", "station"],
      ["gonogo", "pilot"],
      ["gonogo", "rc"],
      ["gonogo", "rc", "station"],
      ["gonogo", "rc", "pilot"],
    ])
      expect(read(...old, "index.html")).toContain("location.replace");
    expect(existsSync(join(site, "gonogo", "dev"))).toBe(false);
  });
});

/** Runs a redirect page's script against a URL and returns where it sent the browser, or null when it stayed. */
function follow(url: string): string | null {
  const script = /<script>([\s\S]*?)<\/script>/.exec(redirectPage("/"))?.[1];
  const { pathname, search, hash } = new URL(url);
  let sent: string | null = null;
  const location = {
    pathname,
    search,
    hash,
    replace: (to: string) => {
      sent = to;
    },
  };
  new Function("location", script ?? "throw new Error('no script')")(location);
  return sent;
}

describe("a redirect from an old project-page URL", () => {
  it("maps each old path to its new home", () => {
    expect(follow("https://x.test/gonogo/")).toBe("/app/");
    expect(follow("https://x.test/gonogo")).toBe("/app/");
    expect(follow("https://x.test/gonogo/station")).toBe("/app/station");
    expect(follow("https://x.test/gonogo/rc/")).toBe("/rc/");
    expect(follow("https://x.test/gonogo/rc/station")).toBe("/rc/station");
  });

  it("keeps the query string and the hash, which is where a station link carries its host", () => {
    expect(follow("https://x.test/gonogo/station?host=XK3F&n=1#join")).toBe(
      "/app/station?host=XK3F&n=1#join",
    );
    expect(follow("https://x.test/gonogo/rc/station/?host=XK3F")).toBe(
      "/rc/station/?host=XK3F",
    );
  });

  it("stays put on a path that was never under /gonogo/, so the root 404 page cannot loop", () => {
    expect(follow("https://x.test/nowhere")).toBeNull();
    expect(follow("https://x.test/app/missing")).toBeNull();
  });
});

describe("deploy.yml's channel check", () => {
  const STEP = "- name: Check the channel and the deploy token";

  /** The step's `run: |` script, read from the workflow so the test runs what CI runs. */
  function checkScript(): string {
    const lines = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../../../.github/workflows/deploy.yml",
      ),
      "utf8",
    ).split("\n");
    const start = lines.findIndex((line) => line.trim() === STEP);
    expect(start, "the channel check step").toBeGreaterThan(-1);
    const run = lines.findIndex(
      (line, i) => i > start && line.trim() === "run: |",
    );
    const indent = lines[run].search(/\S/);
    const body: string[] = [];
    for (const line of lines.slice(run + 1)) {
      if (line.trim() !== "" && line.search(/\S/) <= indent) break;
      body.push(line);
    }
    return body.join("\n");
  }

  const check = (env: Record<string, string>) =>
    spawnSync("bash", ["-c", checkScript()], {
      env: {
        PATH: process.env.PATH,
        PAGES_DEPLOY_TOKEN: "x",
        LABEL: "1.0.0-rc.41",
        ...env,
      },
      encoding: "utf8",
    }).status;

  it("refuses a hand dispatch of the rc channel from any branch but staging", () => {
    expect(
      check({
        CHANNEL: "rc",
        EVENT: "workflow_dispatch",
        REF: "refs/heads/fleet/x",
      }),
    ).toBe(1);
  });

  it("refuses the rc channel with no label", () => {
    expect(
      check({
        CHANNEL: "rc",
        EVENT: "workflow_dispatch",
        REF: "refs/heads/staging",
        LABEL: "",
      }),
    ).toBe(1);
  });

  it("lets rc.yml's call through, which runs on a dispatch of staging", () => {
    expect(
      check({
        CHANNEL: "rc",
        EVENT: "workflow_dispatch",
        REF: "refs/heads/staging",
      }),
    ).toBe(0);
  });

  it("leaves the release channel to release.yml's dispatch on main", () => {
    expect(
      check({
        CHANNEL: "release",
        EVENT: "workflow_dispatch",
        REF: "refs/heads/main",
      }),
    ).toBe(0);
  });
});
