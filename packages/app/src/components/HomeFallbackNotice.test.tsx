import { act, render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import {
  HOME_FALLBACK_NOTICE_MS,
  HomeFallbackNotice,
} from "./HomeFallbackNotice";

const GOLDSTONE = "ground:DSS 14 - Goldstone";
const CANBERRA = "ground:DSS 43 - Canberra";

function centre(
  id: string,
  displayName: string,
  home: "identified" | "fallback" | "no" = "no",
) {
  return {
    id,
    displayName,
    kind: "GroundStation",
    active: true,
    isHome: home !== "no",
    isHomeFallback: home === "fallback",
  };
}

const FALLBACK_ROSTER = [
  centre(GOLDSTONE, "Goldstone", "fallback"),
  centre(CANBERRA, "Canberra"),
];

function mount() {
  const fixture = setupStreamFixture({
    carriedChannels: ["commandCentre.roster"],
    pinnedUt: 10,
  });
  const view = render(
    <fixture.Provider>
      <HomeFallbackNotice />
    </fixture.Provider>,
  );
  const emitRoster = (roster: unknown) => {
    act(() => {
      fixture.emit("commandCentre.roster", roster, { vantage: GOLDSTONE });
      fixture.store.beginFrame();
    });
  };
  return { ...fixture, ...view, emitRoster };
}

const MESSAGE =
  "Couldn't tell which ground station is home, so Goldstone is standing in.";

describe("HomeFallbackNotice", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("explains a fallback home once, naming the centre standing in", () => {
    const fixture = mount();
    fixture.emitRoster(FALLBACK_ROSTER);

    expect(screen.getByRole("status")).toHaveTextContent(MESSAGE);

    act(() => {
      vi.advanceTimersByTime(HOME_FALLBACK_NOTICE_MS);
    });
    expect(screen.queryByRole("status")).toBeNull();

    fixture.unmount();
  });

  it("does not raise it again on a re-render or when the same roster arrives again", () => {
    const fixture = mount();
    fixture.emitRoster(FALLBACK_ROSTER);
    act(() => {
      vi.advanceTimersByTime(HOME_FALLBACK_NOTICE_MS);
    });

    fixture.rerender(
      <fixture.Provider>
        <HomeFallbackNotice />
      </fixture.Provider>,
    );
    fixture.emitRoster(null);
    fixture.emitRoster(FALLBACK_ROSTER);

    expect(screen.queryByRole("status")).toBeNull();

    fixture.unmount();
  });

  it("does not raise it again on a fresh connection to the same fallback in the same session", () => {
    const first = mount();
    first.emitRoster(FALLBACK_ROSTER);
    expect(screen.getByRole("status")).toBeInTheDocument();
    first.unmount();

    const second = mount();
    second.emitRoster(FALLBACK_ROSTER);

    expect(screen.queryByRole("status")).toBeNull();

    second.unmount();
  });

  it("explains a different centre standing in, since that is a new situation", () => {
    const fixture = mount();
    fixture.emitRoster(FALLBACK_ROSTER);
    act(() => {
      vi.advanceTimersByTime(HOME_FALLBACK_NOTICE_MS);
    });

    fixture.emitRoster([
      centre(GOLDSTONE, "Goldstone"),
      centre(CANBERRA, "Canberra", "fallback"),
    ]);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Couldn't tell which ground station is home, so Canberra is standing in.",
    );

    fixture.unmount();
  });

  it("raises nothing for an identified home", () => {
    const fixture = mount();
    fixture.emitRoster([
      centre(GOLDSTONE, "Goldstone", "identified"),
      centre(CANBERRA, "Canberra"),
    ]);

    expect(screen.queryByRole("status")).toBeNull();

    fixture.unmount();
  });

  it("has no a11y violations while shown", async () => {
    vi.useRealTimers();
    const fixture = mount();
    fixture.emitRoster(FALLBACK_ROSTER);

    await expectNoA11yViolations(fixture.container);

    fixture.unmount();
  });
});
