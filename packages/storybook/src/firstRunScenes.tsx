/*
 * The first-run setup, one step at a time, in a world a story chooses: the
 * relay, the KSP connection and the mod's Uplink roster each answering, silent
 * or still being asked. The wizard itself is the app's own, unaltered.
 */
import "./setup";
import {
  type DataSource,
  type DataSourceStatus,
  registerDataSource,
} from "@ksp-gonogo/core";
import { type ReactNode, useEffect, useState } from "react";
import { say } from "../../app/src/firstRun/copy";
import {
  FirstRunSetup,
  type SetupStep,
} from "../../app/src/firstRun/FirstRunSetup";
import { relayBaseUrl } from "../../app/src/peer/iceServers";
import {
  __resetUplinkOutcomes,
  setUplinkOutcome,
  type UplinkLoadOutcome,
} from "../../app/src/uplinks/loaderState";
import { type FixtureEmit, FixtureStream } from "./FixtureStream";

/**
 * What is running around the wizard. `no-uplinks` has the container and KSP
 * answering and a mod with no Uplink installed; `needs-attention` has the same
 * two answering and an Uplink of every kind the Uplinks step can report.
 */
export type SetupWorld =
  | "nothing-running"
  | "all-answering"
  | "checking"
  | "no-uplinks"
  | "needs-attention";

const ROSTER_TOPIC = "system.uplinks";
const HEALTHY = { state: 0, detail: null };

function installed(id: string, name: string, more: object = {}) {
  return {
    id,
    name,
    version: "1.2.0",
    available: true,
    reason: null,
    contractMajor: 4,
    contractMinor: 1,
    health: HEALTHY,
    ...more,
  };
}

function roster(uplinks: object[]): FixtureEmit[] {
  return [
    {
      topic: ROSTER_TOPIC,
      payload: { coreContractMajor: 4, coreContractMinor: 2, uplinks },
    },
  ];
}

const WORKING = [
  installed("cameras", "Camera feeds"),
  installed("terminal", "Scripting terminal"),
];

const EMITS: Record<SetupWorld, FixtureEmit[]> = {
  "nothing-running": [],
  checking: [],
  "all-answering": roster(WORKING),
  "no-uplinks": roster([]),
  "needs-attention": roster([
    ...WORKING,
    installed("mapping", "Surface mapping"),
    installed("robotics", "Robotics", { contractMajor: 3, available: false }),
    installed("weather", "Weather", {
      available: false,
      reason: "The weather mod it reads is not installed",
      health: { state: 2, detail: "No weather mod found" },
    }),
    installed("science", "Science lab"),
    installed("resources", "Resource scanner"),
  ]),
};

const LOADED: UplinkLoadOutcome[] = [
  { id: "cameras", name: "Camera feeds", status: "loaded" },
  { id: "terminal", name: "Scripting terminal", status: "loaded" },
];

const OUTCOMES: Record<SetupWorld, UplinkLoadOutcome[]> = {
  "nothing-running": [],
  checking: [],
  "all-answering": LOADED,
  "no-uplinks": [],
  "needs-attention": [
    ...LOADED,
    { id: "mapping", name: "Surface mapping", status: "loading" },
    {
      id: "science",
      name: "Science lab",
      status: "quarantined",
      reason: "apiVersion incompatible: host 1.0.0, client built for 2.0.0",
    },
    {
      id: "tracking",
      name: "Ground tracking",
      version: "0.9.0",
      status: "loaded",
    },
  ],
};

const KSP: Record<SetupWorld, DataSourceStatus> = {
  "nothing-running": "disconnected",
  checking: "reconnecting",
  "all-answering": "connected",
  "no-uplinks": "connected",
  "needs-attention": "connected",
};

/** The `sitrep` source the connect step reads, holding whatever status the world gives it. */
function sitrepSource(status: DataSourceStatus): DataSource {
  return {
    id: "sitrep",
    name: "Sitrep Stream",
    status,
    connect: async () => {},
    disconnect: () => {},
    schema: () => [],
    subscribe: () => () => {},
    configSchema: () => [
      { key: "host", label: "Host", type: "text" },
      { key: "port", label: "Port", type: "number" },
    ],
    getConfig: () => ({ host: "localhost", port: 8090 }),
    configure: () => {},
    onStatusChange: () => () => {},
  };
}

/** Answers the relay's health check as the world has it, and passes every other request through. */
function answerRelay(world: SetupWorld): () => void {
  const real = globalThis.fetch;
  const health = `${relayBaseUrl()}/health`;
  globalThis.fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== health) return real(input, init);
    if (world === "checking") return new Promise(() => {});
    if (world === "nothing-running")
      return Promise.reject(new TypeError("Failed to fetch"));
    return Promise.resolve(Response.json({ status: "ok", turn: null }));
  };
  return () => {
    globalThis.fetch = real;
  };
}

export interface FirstRunSceneProps {
  step: SetupStep;
  world: SetupWorld;
}

/** The dialog the app opens the wizard in, as far as a still page needs it: its title above its content. */
function Dialog({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <section
      aria-label={say("shell.title")}
      style={{
        maxWidth: 640,
        display: "flex",
        flexDirection: "column",
        gap: "var(--gap-related-comfortable)",
      }}
    >
      <h2 style={{ margin: 0, fontSize: "var(--font-size-lg)" }}>
        {say("shell.title")}
      </h2>
      {children}
    </section>
  );
}

/** One wizard step in one world. */
export function FirstRunScene({ step, world }: Readonly<FirstRunSceneProps>) {
  // Set as the scene is created rather than in an effect: the steps read all three on their first render.
  const [restoreFetch] = useState(() => {
    registerDataSource(sitrepSource(KSP[world]));
    __resetUplinkOutcomes();
    for (const outcome of OUTCOMES[world]) setUplinkOutcome(outcome);
    return answerRelay(world);
  });
  useEffect(() => restoreFetch, [restoreFetch]);

  return (
    <FixtureStream subscribed={[ROSTER_TOPIC]} emits={EMITS[world]}>
      <Dialog>
        <FirstRunSetup initialStep={step} />
      </Dialog>
    </FixtureStream>
  );
}
