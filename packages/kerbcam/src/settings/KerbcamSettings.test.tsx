import { clearRegistry, registerDataSource } from "@gonogo/core";
import { MockSidecar } from "@jonpepler/kerbcam/testing";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KerbcamDataSource } from "../KerbcamDataSource";
import { kerbcamFetchImpl } from "../test/MockKerbcamSession";
import { KerbcamSettings } from "./KerbcamSettings";

function isChecked(el: HTMLElement): boolean {
  return (el as HTMLInputElement).checked;
}

// Sources created during a test are torn down in afterEach AFTER cleanup() so
// KerbcamSettings is already unmounted when disconnect() fires. Disconnecting a
// live source while the component is still mounted triggers useSyncExternalStore
// state updates outside act() -- the documented anti-pattern.
const createdSources: Array<{ disconnect: () => void }> = [];

/*
 * Helper: set up a connected MockSidecar + KerbcamDataSource pair.
 * Registers the source in the global registry so hooks can find it.
 * Returns the sidecar (for inspecting commands / pushing settings-state) and
 * the source (for prop-drilling into KerbcamSettings).
 */
async function connectedFixture(): Promise<{
  sidecar: MockSidecar;
  source: KerbcamDataSource;
}> {
  const sidecar = new MockSidecar();
  const source = new KerbcamDataSource(
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
  cleanup();
  for (const ds of createdSources) ds.disconnect();
  createdSources.length = 0;
  clearRegistry();
});

describe("KerbcamSettings", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(kerbcamFetchImpl());
  });

  it("renders a switch that defaults to off before any SettingsState arrives", async () => {
    const { source } = await connectedFixture();
    render(<KerbcamSettings source={source} />);
    const toggle = screen.getByRole("checkbox");
    expect(isChecked(toggle)).toBe(false);
  });

  it("sends set-throttle-main-screen when the switch is toggled on", async () => {
    const { sidecar, source } = await connectedFixture();
    render(<KerbcamSettings source={source} />);

    fireEvent.click(screen.getByRole("checkbox"));

    const cmd = sidecar.lastCommand("set-throttle-main-screen");
    expect(cmd).toBeDefined();
    expect(cmd?.content.enabled).toBe(true);
  });

  it("reflects state pushed by a SettingsState broadcast", async () => {
    const { sidecar, source } = await connectedFixture();
    render(<KerbcamSettings source={source} />);

    act(() => {
      sidecar.fireSettingsState({ throttleMainScreen: true });
    });

    expect(isChecked(screen.getByRole("checkbox"))).toBe(true);
  });

  it("reflects an externally-originated change (another client toggled it off)", async () => {
    const { sidecar, source } = await connectedFixture();
    render(<KerbcamSettings source={source} />);

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
