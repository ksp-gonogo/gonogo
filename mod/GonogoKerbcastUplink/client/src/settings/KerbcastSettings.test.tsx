import { clearRegistry } from "@ksp-gonogo/core";
import { MockSidecar } from "@ksp-gonogo/kerbcast/testing";
import { registerDataSource } from "@ksp-gonogo/sitrep-sdk";
import { act, fireEvent, render, screen } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KerbcastDataSource } from "../KerbcastDataSource";
import { kerbcastFetchImpl } from "../test/MockKerbcastSession";
import { KerbcastSettings } from "./KerbcastSettings";

function isChecked(el: HTMLElement): boolean {
  return (el as HTMLInputElement).checked;
}

// Sources created during a test are torn down in afterEach AFTER the component
// is unmounted, so KerbcastSettings is already gone when disconnect() fires.
// Disconnecting a live source while the component is still mounted triggers
// useSyncExternalStore state updates outside act() -- the documented
// anti-pattern.
const createdSources: Array<{ disconnect: () => void }> = [];

// Rendered trees, tracked so afterEach can unmount them BEFORE disconnecting
// sources. RTL's auto-cleanup runs after this file's afterEach, so it can't be
// relied on to unmount first -- we do it explicitly here.
const renderedTrees: Array<() => void> = [];

function renderSettings(source: KerbcastDataSource): ReturnType<typeof render> {
  const result = render(<KerbcastSettings source={source} />);
  renderedTrees.push(result.unmount);
  return result;
}

/*
 * Helper: set up a connected MockSidecar + KerbcastDataSource pair.
 * Registers the source in the global registry so hooks can find it.
 * Returns the sidecar (for inspecting commands / pushing settings-state) and
 * the source (for prop-drilling into KerbcastSettings).
 */
async function connectedFixture(): Promise<{
  sidecar: MockSidecar;
  source: KerbcastDataSource;
}> {
  const sidecar = new MockSidecar();
  const source = new KerbcastDataSource(
    { host: "h", port: 1 },
    sidecar.createTransport(),
  );
  registerDataSource(
    source as unknown as Parameters<typeof registerDataSource>[0],
  );
  await source.connect();
  sidecar.open();
  sidecar.setConnectionState("connected");
  createdSources.push(source);
  return { sidecar, source };
}

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  for (const ds of createdSources) ds.disconnect();
  createdSources.length = 0;
  clearRegistry();
});

describe("KerbcastSettings", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(kerbcastFetchImpl());
  });

  it("renders a switch that defaults to off before any SettingsState arrives", async () => {
    const { source } = await connectedFixture();
    renderSettings(source);
    const toggle = screen.getByRole("checkbox");
    expect(isChecked(toggle)).toBe(false);
  });

  it("sends set-throttle-main-screen when the switch is toggled on", async () => {
    const { sidecar, source } = await connectedFixture();
    renderSettings(source);

    fireEvent.click(screen.getByRole("checkbox"));

    const cmd = sidecar.lastCommand("set-throttle-main-screen");
    expect(cmd).toBeDefined();
    expect(cmd?.content.enabled).toBe(true);
  });

  it("reflects state pushed by a SettingsState broadcast", async () => {
    const { sidecar, source } = await connectedFixture();
    renderSettings(source);

    act(() => {
      sidecar.fireSettingsState({ throttleMainScreen: true });
    });

    expect(isChecked(screen.getByRole("checkbox"))).toBe(true);
  });

  it("reflects an externally-originated change (another client toggled it off)", async () => {
    const { sidecar, source } = await connectedFixture();
    renderSettings(source);

    /* Sidecar pushes throttle-on (e.g. from Hello or another client). */
    act(() => {
      sidecar.fireSettingsState({ throttleMainScreen: true });
    });
    expect(isChecked(screen.getByRole("checkbox"))).toBe(true);

    /* Another client turns it off: sidecar broadcasts updated state. */
    act(() => {
      sidecar.fireSettingsState({ throttleMainScreen: false });
    });
    expect(isChecked(screen.getByRole("checkbox"))).toBe(false);
  });
});
