import { clearRegistry } from "@ksp-gonogo/core";
import type { KosProcessorInfo } from "@ksp-gonogo/sitrep-sdk";
import {
  act,
  render as rtlRender,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { KosProcessorsComponent } from "./index";
import "./processorsScript";

/**
 * Proves KosProcessors genuinely reads the Gonogo mod's native
 * `kos.processors` push channel off the real
 * `TelemetryProvider`/`TelemetryClient`/`TimelineStore` pipeline (via
 * `StubTransport`) — the first user-facing kOS widget on the new mod streams.
 * No mocking of `useDataValue`/`useKosScriptStatus` (per CLAUDE.md); the
 * widget runs its real dual-source read, adapter, and stream-status path.
 */
const MOD_PROCS: KosProcessorInfo[] = [
  {
    coreId: 101,
    tag: "MainCPU",
    hasBooted: true,
    bootFilePath: "boot/main.ks",
    processorMode: "READY",
  },
  {
    coreId: 102,
    tag: undefined,
    hasBooted: false,
    bootFilePath: undefined,
    processorMode: "OFF",
  },
];

// Rendered trees, tracked so afterEach can unmount them BEFORE clearing the
// registry. RTL auto-cleanup runs after this file's afterEach, so it can't be
// relied on to unmount first — a late stream frame landing on the still-mounted
// widget is a state update outside act(), the documented anti-pattern in
// CLAUDE.md.
const renderedTrees: Array<() => void> = [];

function render(ui: ReactElement) {
  const result = rtlRender(ui);
  renderedTrees.push(result.unmount);
  return result;
}

describe("KosProcessors — reads kos.processors off the stream (U3 kOS slice)", () => {
  beforeEach(() => {
    clearRegistry();
    void import("./processorsScript");
  });

  afterEach(() => {
    for (const unmount of renderedTrees) unmount();
    renderedTrees.length = 0;
    clearRegistry();
  });

  it("renders a CPU row per mod-shape KosProcessorInfo via the adapter", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["kos.processors"],
      pinnedUt: 10,
    });

    render(
      <fixture.Provider>
        <KosProcessorsComponent config={{}} w={6} h={8} />
      </fixture.Provider>,
    );

    expect(fixture.transport.isSubscribed("kos.processors")).toBe(true);

    act(() => {
      fixture.emit("kos.processors", MOD_PROCS);
    });

    // camelCase contract fields adapted onto the render's KosProcessor shape:
    // tag -> tag, processorMode -> mode, bootFilePath -> boot pill.
    expect(await screen.findByText("MainCPU")).toBeInTheDocument();
    expect(screen.getByText("READY")).toBeInTheDocument();
    expect(screen.getByText(/boot · boot\/main\.ks/)).toBeInTheDocument();
    // Second CPU has no tag -> "untagged", OFF mode.
    expect(screen.getByText(/untagged/i)).toBeInTheDocument();
    expect(screen.getByText("OFF")).toBeInTheDocument();
  });

  it("hides the Run / Re-enable affordances on the native push channel", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["kos.processors"],
      pinnedUt: 10,
    });

    render(
      <fixture.Provider>
        <KosProcessorsComponent config={{}} w={6} h={8} />
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("kos.processors", MOD_PROCS);
    });

    await screen.findByText("MainCPU");
    // Run/Re-enable are compute-feed commands with no meaning for a push feed.
    expect(
      screen.queryByRole("button", { name: /run/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /re-?enable/i }),
    ).not.toBeInTheDocument();
    // No paused/error banner either — push telemetry has no breaker.
    expect(screen.queryByText(/Paused/i)).not.toBeInTheDocument();
  });

  it("has no axe violations rendering off the stream", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["kos.processors"],
      pinnedUt: 10,
    });

    const { container } = render(
      <fixture.Provider>
        <KosProcessorsComponent config={{}} w={6} h={8} />
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("kos.processors", MOD_PROCS);
    });

    await screen.findByText("MainCPU");
    await waitFor(async () => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
