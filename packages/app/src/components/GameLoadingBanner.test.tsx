import { act, render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { GameLoadingBanner } from "./GameLoadingBanner";

function mount() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const fixture = setupStreamFixture({ pinnedUt: 10 });
  const view = render(
    <fixture.Provider>
      <GameLoadingBanner />
    </fixture.Provider>,
  );
  return { ...fixture, ...view };
}

describe("GameLoadingBanner", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("says nothing while the game is ready", () => {
    mount();

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("names the scene being loaded once the load has run long enough to show", async () => {
    const { store, container } = mount();

    act(() => store.setGameState("loading", "FLIGHT"));
    expect(screen.queryByRole("status")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(750);
    });
    const banner = screen.getByRole("status");
    expect(banner.textContent).toContain("KSP is loading Flight");
    vi.useRealTimers();
    await expectNoA11yViolations(container);
  });

  it("goes when the game is ready again", () => {
    const { store } = mount();
    act(() => store.setGameState("loading", "SPACECENTER"));
    act(() => {
      vi.advanceTimersByTime(750);
    });
    expect(screen.getByRole("status").textContent).toContain("Space Center");

    act(() => store.setGameState("ready", "SPACECENTER"));

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("never appears for a load that ends inside the onset", () => {
    const { store } = mount();

    act(() => store.setGameState("loading", "SPACECENTER"));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    act(() => store.setGameState("ready", "SPACECENTER"));
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says there is no game at the main menu, at once", async () => {
    const { store, container } = mount();

    act(() => store.setGameState("no-game", "MAINMENU"));

    expect(screen.getByRole("status").textContent).toContain("No game loaded");
    vi.useRealTimers();
    await expectNoA11yViolations(container);
  });
});
