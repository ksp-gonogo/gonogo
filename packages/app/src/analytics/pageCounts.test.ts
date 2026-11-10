import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createPageCounter,
  isUsableSiteCode,
  listingPath,
  type PageCounterEnv,
  PLACEHOLDER_SITE_CODE,
  pageCounter,
} from "./pageCounts";

function setup(over: Partial<PageCounterEnv> = {}) {
  const sent: string[] = [];
  const counter = createPageCounter({
    site: "gonogo-test",
    enabled: true,
    location: {
      pathname: "/app/",
      hostname: "ksp-gonogo.github.io",
      origin: "https://ksp-gonogo.github.io",
    },
    base: "/app/",
    referrer: "",
    title: "gonogo",
    send: (url) => sent.push(url),
    ...over,
  });
  return { counter, sent };
}

/** A dotted address built from its parts, so the home-network cases do not read as a literal address. */
const address = (...parts: number[]) => parts.join(".");

const paths = (sent: string[]) =>
  sent.map((url) => new URL(url).searchParams.get("p"));

describe("listingPath", () => {
  it("keeps the release and RC apps under their own prefixes", () => {
    expect(listingPath("/app/", "ksp-gonogo.github.io", "/app/")).toBe("/app");
    expect(listingPath("/rc/station", "ksp-gonogo.github.io", "/rc/")).toBe(
      "/rc/station",
    );
  });

  it("lists a pilot page as /pilot on either channel", () => {
    expect(listingPath("/app/pilot", "x.github.io", "/app/")).toBe("/pilot");
    expect(listingPath("/rc/pilot/station", "x.github.io", "/rc/")).toBe(
      "/pilot/station",
    );
  });

  it("puts a loopback or home network address under /local with the app path", () => {
    expect(listingPath("/", "localhost", "/")).toBe("/local");
    expect(listingPath("/station", address(192, 168, 1, 20), "/")).toBe(
      "/local/station",
    );
    expect(listingPath("/pilot", address(172, 20, 0, 3), "/")).toBe(
      "/local/pilot",
    );
    expect(listingPath("/", address(10, 0, 0, 5), "/")).toBe("/local");
  });
});

describe("page counting", () => {
  it("counts the page once, as a visit", () => {
    const { counter, sent } = setup();
    counter.countPage();
    counter.countPage();
    expect(paths(sent)).toEqual(["/app"]);
    expect(sent[0]).toMatch(
      /^https:\/\/gonogo-test\.goatcounter\.com\/count\?/,
    );
    expect(new URL(sent[0]).searchParams.has("e")).toBe(false);
  });

  it("sends each journey event once as an event", () => {
    const { counter, sent } = setup();
    for (const name of [
      "game-connected",
      "game-connected",
      "station-joined",
      "pilot-joined",
      "pilot-joined",
    ] as const) {
      counter.event(name);
    }
    expect(paths(sent)).toEqual([
      "game-connected",
      "station-joined",
      "pilot-joined",
    ]);
    expect(
      sent.every((url) => new URL(url).searchParams.get("e") === "true"),
    ).toBe(true);
  });

  it("fires 'arrived from landing' only when the landing page is the referrer", () => {
    const arrived = setup({ referrer: "https://ksp-gonogo.github.io/" });
    arrived.counter.countPage();
    expect(paths(arrived.sent)).toEqual(["/app", "arrived-from-landing"]);

    for (const referrer of [
      "",
      "https://ksp-gonogo.github.io/app/station",
      "https://example.com/",
      "https://ksp-gonogo.github.io/uplink-dev-docs/",
    ]) {
      const other = setup({ referrer });
      other.counter.countPage();
      expect(paths(other.sent)).toEqual(["/app"]);
    }
  });

  it("sends nothing while the site code is the placeholder or unusable", () => {
    for (const site of [
      PLACEHOLDER_SITE_CODE,
      undefined,
      "__GOATCOUNTER_SITE__",
      "",
    ]) {
      const { counter, sent } = setup({
        site,
        referrer: "https://ksp-gonogo.github.io/",
      });
      counter.countPage();
      counter.event("game-connected");
      expect(sent).toEqual([]);
    }
    expect(isUsableSiteCode("gonogo")).toBe(true);
    expect(isUsableSiteCode("ksp-gonogo")).toBe(true);
    expect(isUsableSiteCode(PLACEHOLDER_SITE_CODE)).toBe(false);
  });

  it("sends nothing when disabled", () => {
    const { counter, sent } = setup({ enabled: false });
    counter.countPage();
    counter.event("station-joined");
    expect(sent).toEqual([]);
  });

  it("counts with the real hyphenated site code", () => {
    const { counter, sent } = setup({ site: "ksp-gonogo" });
    counter.countPage();
    expect(sent[0]).toMatch(/^https:\/\/ksp-gonogo\.goatcounter\.com\/count\?/);
  });

  it("is disabled in a test run", () => {
    const counter = pageCounter();
    const images: string[] = [];
    class RecordingImage {
      set src(value: string) {
        images.push(value);
      }
    }
    vi.stubGlobal("Image", RecordingImage);
    try {
      counter.countPage();
      counter.event("game-connected");
    } finally {
      vi.unstubAllGlobals();
    }
    expect(images).toEqual([]);
  });
});

interface LandingCounting {
  start: (env: {
    site: string;
    enabled: boolean;
    title: string;
    document: Document;
    send: (url: string) => void;
  }) => void;
}

declare global {
  interface Window {
    GonogoLandingCounting?: LandingCounting;
  }
}

describe("landing page counting script", () => {
  const source = readFileSync(
    resolve(__dirname, "../../../../docs/homepage/counting.js"),
    "utf8",
  );
  const load = (): LandingCounting => {
    new Function(source)();
    const landing = window.GonogoLandingCounting;
    if (!landing) throw new Error("counting.js did not register");
    return landing;
  };

  function mount(site: string, enabled = true) {
    document.body.innerHTML = `
      <a id="app" href="https://ksp-gonogo.github.io/app/">App</a>
      <a id="rc" href="https://ksp-gonogo.github.io/rc/">RC</a>
      <a id="gh" href="https://github.com/ksp-gonogo/gonogo">GitHub</a>
      <ol class="steps">
        <li><details><summary id="s1">Install</summary>
          <a id="ckan" href="https://github.com/KSP-CKAN/CKAN/wiki/Installing-CKAN">CKAN</a>
          <a id="spacedock" href="https://spacedock.info/mod/1">SpaceDock</a>
          <a id="releases" href="https://github.com/ksp-gonogo/gonogo/releases">Releases</a>
          <a id="guide" href="https://github.com/ksp-gonogo/gonogo/blob/main/docs/KSP-SETUP.md">Guide</a>
          <button id="copy-ckan" type="button" data-copy="ckan-filter">Copy</button></details></li>
        <li><details><summary id="s2">Start</summary>
          <a id="docker" href="https://www.docker.com/">Docker</a>
          <a id="podman" href="https://podman.io/">Podman</a>
          <a id="net" href="https://github.com/ksp-gonogo/gonogo/blob/main/docs/NETWORKING.md#x">Net</a>
          <button id="copy-run" type="button" data-copy="run-command">Copy</button>
          <button id="copy-other" type="button" data-copy="other">Copy</button></details></li>
        <li><details><summary id="s3">Open</summary>
          <a id="local" href="http://localhost:8080">Local</a></details></li>
      </ol>`;
    const sent: string[] = [];
    for (const link of document.querySelectorAll("a")) {
      link.addEventListener("click", (event) => event.preventDefault());
    }
    load().start({
      site,
      enabled,
      title: "gonogo",
      document,
      send: (u) => sent.push(u),
    });
    return sent;
  }

  it("counts the landing visit and each app link click once, by name", () => {
    const sent = mount("gonogo-test");
    document.getElementById("gh")?.click();
    document.getElementById("rc")?.click();
    document.getElementById("rc")?.click();
    document.getElementById("app")?.click();
    expect(paths(sent)).toEqual(["/", "open-app-rc", "open-app-app"]);
    expect(new URL(sent[1]).searchParams.get("e")).toBe("true");
  });

  it("counts opening each install step once, named by step number", () => {
    const sent = mount("gonogo-test");
    document.getElementById("s2")?.click();
    document.getElementById("s2")?.click();
    document.getElementById("s1")?.click();
    document.getElementById("s3")?.click();
    expect(paths(sent)).toEqual([
      "/",
      "install-step-2",
      "install-step-1",
      "install-step-3",
    ]);
  });

  it("counts each install action once by a fixed name", () => {
    const sent = mount("gonogo-test");
    const click = (id: string) => document.getElementById(id)?.click();
    for (const id of [
      "ckan",
      "ckan",
      "spacedock",
      "releases",
      "guide",
      "docker",
      "podman",
      "net",
      "local",
      "copy-ckan",
      "copy-run",
      "copy-run",
      "copy-other",
    ]) {
      click(id);
    }
    expect(paths(sent)).toEqual([
      "/",
      "install-ckan",
      "install-download-spacedock",
      "install-download-mod",
      "install-setup-guide",
      "install-docker",
      "install-podman",
      "install-networking-guide",
      "install-open-local-app",
      "install-ckan-copy",
      "install-docker-copy",
    ]);
    expect(
      sent.slice(1).every((u) => new URL(u).searchParams.get("e") === "true"),
    ).toBe(true);
  });

  it("counts with the real hyphenated site code", () => {
    expect(paths(mount("ksp-gonogo"))).toEqual(["/"]);
  });

  it("sends nothing with the placeholder code, the unfilled token or when disabled", () => {
    expect(mount(PLACEHOLDER_SITE_CODE)).toEqual([]);
    expect(mount("__GOATCOUNTER_SITE__")).toEqual([]);
    expect(mount("gonogo-test", false)).toEqual([]);
  });
});
