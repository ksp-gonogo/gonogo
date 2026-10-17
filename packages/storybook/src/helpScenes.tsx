/*
 * The first-load page, the Settings version row and the empty dashboard, each
 * driven by the app's own component in a world a story chooses.
 */
import "./setup";
import { type ReactNode, useEffect, useState } from "react";
import { OverlayProvider } from "../../app/src/components/ComponentOverlay";
import { EmptyDashboardNotice } from "../../app/src/components/Dashboard/EmptyDashboardNotice";
import { AppVersion } from "../../app/src/settings/AppVersion";
import {
  __resetLatestRelease,
  LATEST_RELEASE_URL,
} from "../../app/src/settings/releaseCheck";
import type { ConsentInfo } from "../../app/src/uplinks/consent";
import { FirstLoadChoices } from "../../app/src/uplinks/FirstLoadChoices";
import { resolveUplinkIdentity } from "../../app/src/uplinks/identity";
import { VERSION } from "../../app/src/version";
import { FixtureStream } from "./FixtureStream";

function uplink(
  id: string,
  name: string,
  mod: { name: string; builtAgainst: string },
): ConsentInfo {
  const author = "jpeps";
  return {
    id,
    name,
    version: "0.0.1",
    author,
    identity: resolveUplinkIdentity(
      id,
      { name, author, repo: "https://github.com/ksp-gonogo/gonogo-uplinks" },
      {},
    ),
    mod,
  };
}

const UPLINKS: readonly ConsentInfo[] = [
  uplink("plotter", "Plotter", { name: "Plotter", builtAgainst: "1.6.0.1" }),
  uplink("survey", "Survey", { name: "Survey", builtAgainst: "20.4" }),
  uplink("dockcam", "Docking Camera", {
    name: "Docking Camera",
    builtAgainst: "1.8.1",
  }),
];

export type ChoicesState = "unanswered" | "partly" | "answered" | "station";

const INITIAL: Record<ChoicesState, { uplinks: (boolean | undefined)[] }> = {
  unanswered: { uplinks: [] },
  partly: { uplinks: [true, true] },
  answered: { uplinks: [true, true, false] },
  station: { uplinks: [true] },
};

/** The dialog chrome the first-load page opens in, as far as a still page needs it. */
function Dialog({
  title,
  children,
}: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <section
      aria-label={title}
      data-story-widget
      style={{
        maxWidth: 640,
        display: "flex",
        flexDirection: "column",
        gap: "var(--gap-related-comfortable)",
        padding: "1.5rem",
        border: "1px solid var(--color-border-strong)",
        borderRadius: "var(--radius-floating)",
        background: "var(--color-surface-raised)",
      }}
    >
      <h2 style={{ margin: 0, fontSize: "1.1rem" }}>{title}</h2>
      {children}
    </section>
  );
}

/** The first-load page in one answering state. */
export function FirstLoadChoicesScene({
  state,
}: Readonly<{ state: ChoicesState }>) {
  return (
    <Dialog title="Before you start">
      <FirstLoadChoices
        key={state}
        uplinks={UPLINKS}
        initial={INITIAL[state]}
        onDone={() => {}}
      />
    </Dialog>
  );
}

export type VersionWorld = "update" | "current" | "offline" | "mismatch";

/** Read against the build the story runs in, so "current" is current whatever version that is. */
const LATEST: Record<VersionWorld, string | null> = {
  update: "1.1.0",
  current: VERSION,
  offline: null,
  mismatch: VERSION,
};

const MOD: Record<VersionWorld, string | null> = {
  update: `v${VERSION}`,
  current: `v${VERSION}`,
  offline: `v${VERSION}`,
  mismatch: "v0.9.2",
};

/** GitHub's answer for the newest release in `world`, in place of the network. */
function answerGitHub(world: VersionWorld): () => void {
  const real = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== LATEST_RELEASE_URL) return real(input, init);
    const tag = LATEST[world];
    if (tag === null) return Promise.reject(new TypeError("Failed to fetch"));
    return Promise.resolve(
      Response.json({
        tag_name: `v${tag}`,
        html_url: `https://github.com/ksp-gonogo/gonogo/releases/tag/v${tag}`,
      }),
    );
  };
  return () => {
    globalThis.fetch = real;
  };
}

/** The About section of Settings, General, in one world. */
export function AppVersionScene({ world }: Readonly<{ world: VersionWorld }>) {
  // Set as the scene is created rather than in an effect: the row asks GitHub on its first render.
  const [restoreFetch] = useState(() => {
    __resetLatestRelease();
    return answerGitHub(world);
  });
  useEffect(() => restoreFetch, [restoreFetch]);

  return (
    <FixtureStream
      subscribed={["system.uplinks"]}
      emits={[
        {
          topic: "system.uplinks",
          payload: { uplinks: [], coreVersion: MOD[world] },
        },
      ]}
    >
      <Dialog title="About">
        <AppVersion />
      </Dialog>
    </FixtureStream>
  );
}

/** A dashboard with no widgets, inside a screen whose picker its button opens. */
export function EmptyDashboardScene() {
  return (
    <OverlayProvider addItem={() => {}} updateItemConfig={() => {}}>
      <div data-story-widget>
        <EmptyDashboardNotice />
      </div>
    </OverlayProvider>
  );
}
