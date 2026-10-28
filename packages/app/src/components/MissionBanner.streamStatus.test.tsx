import { act, render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { MissionBanner } from "./MissionBanner";

function mount() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const fixture = setupStreamFixture({ pinnedUt: 10 });
  const view = render(
    <fixture.Provider>
      <MissionBanner />
    </fixture.Provider>,
  );
  return { ...fixture, ...view };
}

describe("MissionBanner stream status", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("says nothing while the stream is open", () => {
    mount();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says the mod is not connected once the stream has stayed down, and goes when it returns", async () => {
    const { store, container } = mount();

    act(() => store.setTransportConnected(false));
    expect(screen.queryByRole("status")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByRole("status").textContent).toContain("Not connected");
    vi.useRealTimers();
    await expectNoA11yViolations(container);

    act(() => store.setTransportConnected(true));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("never appears for a drop that ends inside the onset", () => {
    const { store } = mount();
    act(() => store.setTransportConnected(false));
    act(() => {
      vi.advanceTimersByTime(400);
    });
    act(() => store.setTransportConnected(true));
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByRole("status")).toBeNull();
  });
});
