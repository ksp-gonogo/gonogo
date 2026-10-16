import { TelemetryClient, TelemetryProvider } from "@ksp-gonogo/sitrep-client";
import { harnessTheme, StubTransport } from "@ksp-gonogo/sitrep-sdk/testing";
import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider } from "styled-components";
import { UplinkReadinessStep } from "../../src/firstRun/steps/UplinkReadinessStep";
import {
  type ConsentInfo,
  setConsentBatchPrompt,
} from "../../src/uplinks/consent";
import { FirstLoadPage } from "../../src/uplinks/consentModal";
import { hostCompat } from "../../src/uplinks/hostCompat";
import { loadEnabledUplinks, type RosterEntry } from "../../src/uplinks/loader";
import { __resetUplinkOutcomes } from "../../src/uplinks/loaderState";
import type { RegistryIndex } from "../../src/uplinks/registry";

/**
 * Browser entry for the Uplink first-load render harness. esbuild bundles it
 * into `uplink-load-probe.html`, and `scripts/render-uplink-load.ts` drives it
 * through `window.__renderUplinkLoad`.
 *
 * Each scene runs the real loader over a fixed roster: Breaking Ground and
 * Making History as the core mod reports them (no author, no repo, no client
 * hash) and one third-party Uplink. Whatever the loader asks is answered Skip,
 * then the scene draws either the page it asked with or the setup Uplinks step
 * the outcomes leave behind.
 */

interface Scene {
  screen: "main" | "station";
  view: "prompt" | "setup";
}

const BYTES = new TextEncoder().encode("export const marker = 1;")
  .buffer as ArrayBuffer;

async function sha256Of(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256-${hex}`;
}

const UPLINKS = [
  {
    id: "breakingGround",
    name: "Breaking Ground",
    author: "ksp-gonogo",
    bundled: true,
  },
  {
    id: "makingHistory",
    name: "Making History",
    author: "ksp-gonogo",
    bundled: true,
  },
  { id: "orbitLab", name: "Orbit Lab", author: "a-mod-author", bundled: false },
];

function indexOf(integrity: string): RegistryIndex {
  return {
    uplinks: UPLINKS.map((u) => ({
      id: u.id,
      name: u.name,
      author: u.author,
      repo: `${u.author}/${u.id}`,
      ...(u.bundled ? { bundled: true as const } : {}),
      versions: [
        {
          version: "1.0.0",
          minAppVersion: "0.0.0",
          apiVersion: hostCompat.apiVersion,
          contractMajor: hostCompat.contractMajor,
          contractMinor: hostCompat.contractMinor,
          bundleUrl: `/uplinks/${u.id}.client.js`,
          integrity,
          expectedClientHash: null,
        },
      ],
    })),
  };
}

function rosterOf(integrity: string): RosterEntry[] {
  return UPLINKS.map((u) => ({
    id: u.id,
    version: "1.0.0",
    available: true,
    reason: null,
    name: u.name,
    author: u.bundled ? null : u.author,
    repo: u.bundled ? null : `${u.author}/${u.id}`,
    expectedClientHash: u.bundled ? null : integrity,
  }));
}

function systemUplinks(integrity: string) {
  return {
    coreContractMajor: hostCompat.contractMajor,
    coreContractMinor: hostCompat.contractMinor,
    uplinks: UPLINKS.map((u) => ({
      id: u.id,
      name: u.name,
      version: "1.0.0",
      available: true,
      reason: null,
      author: u.bundled ? null : u.author,
      repo: u.bundled ? null : `${u.author}/${u.id}`,
      expectedClientHash: u.bundled ? null : integrity,
      health: { state: 0, detail: null, facts: [] },
      contractMajor: hostCompat.contractMajor,
      contractMinor: hostCompat.contractMinor,
    })),
  };
}

let root: Root | undefined;
let client: TelemetryClient | undefined;

const twoFrames = (): Promise<unknown> =>
  new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

async function renderScene(scene: Scene): Promise<void> {
  const host = document.getElementById("root");
  if (!host) throw new Error("#root missing");
  root?.unmount();
  client?.dispose();
  localStorage.clear();
  __resetUplinkOutcomes();

  const integrity = await sha256Of(BYTES);
  const index = indexOf(integrity);
  window.fetch = async () => Response.json(index);

  let asked: readonly ConsentInfo[] = [];
  setConsentBatchPrompt(async (infos) => {
    asked = infos;
    return infos.map(() => false);
  });

  await loadEnabledUplinks({
    registrySource: { url: "/uplinks/registry.local.json" },
    hostCompat,
    appVersion: "1.0.0",
    roster: rosterOf(integrity),
    fetchBytes: async () => BYTES,
    importBundle: async () => ({}),
    bundlesFromHost: scene.screen === "station" ? true : undefined,
  });

  root = createRoot(host);
  if (scene.view === "prompt") {
    root.render(
      <ThemeProvider theme={harnessTheme}>
        {asked.length > 0 ? (
          <FirstLoadPage uplinks={asked} askLogs={false} onDone={() => {}} />
        ) : (
          <p>No first-load page</p>
        )}
      </ThemeProvider>,
    );
    await twoFrames();
    return;
  }

  const transport = new StubTransport();
  client = new TelemetryClient(transport);
  root.render(
    <ThemeProvider theme={harnessTheme}>
      <TelemetryProvider client={client}>
        <div style={{ padding: 16 }}>
          <UplinkReadinessStep />
        </div>
      </TelemetryProvider>
    </ThemeProvider>,
  );
  await twoFrames();
  transport.emitRaw({
    type: "stream-data",
    topic: "system.uplinks",
    payload: systemUplinks(integrity),
    meta: {
      source: "probe",
      validAt: 1,
      seq: 0,
      deliveredAt: 1,
      vantage: "probe",
      quality: 0,
      active: false,
      staleness: 0,
      timelineEpoch: 0,
    },
  } as never);
  await twoFrames();
}

(
  window as unknown as { __renderUplinkLoad: (s: Scene) => Promise<void> }
).__renderUplinkLoad = renderScene;
