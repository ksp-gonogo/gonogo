import {
  clearMapPoiProviders,
  type MapPoi,
  registerMapPoiProvider,
} from "@ksp-gonogo/core";
import { act, fireEvent, render, screen } from "@ksp-gonogo/test-utils";
import {
  expectNoA11yViolations,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { MapPoiLayer } from "./MapPoiLayer";

// Unmount each tree before clearMapPoiProviders(), which would re-render a mounted layer outside act(); RTL's auto-cleanup runs too late.
const renderedTrees: Array<() => void> = [];
/** Past the layer's close grace. */
const CARD_GRACE = 250;
afterEach(() => {
  vi.useRealTimers();
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearMapPoiProviders();
});

const project = (lat: number, lon: number) => ({ x: lat, y: lon });

function renderLayer() {
  const view = render(<MapPoiLayer bodyId="Kerbin" project={project} />);
  renderedTrees.push(view.unmount);
  return view;
}

function makePoi(overrides: Partial<MapPoi> = {}): MapPoi {
  return {
    id: "poi-1",
    bodyId: "Kerbin",
    lat: -0.05,
    lon: -74.7,
    kind: "ksc",
    label: "KSC",
    ...overrides,
  };
}

describe("MapPoiLayer", () => {
  it("renders a marker only for a provider whose requires gate is satisfied", () => {
    registerMapPoiProvider({
      id: "gated",
      requires: "fake-domain",
      usePois: () => [makePoi({ id: "gated-poi", label: "Gated POI" })],
    });
    registerMapPoiProvider({
      id: "ungated",
      usePois: () => [makePoi({ id: "ungated-poi", label: "Ungated POI" })],
    });

    renderLayer();

    expect(screen.queryByRole("button", { name: "Gated POI" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Ungated POI" }),
    ).toBeInTheDocument();
  });

  it("subscribes a gated provider's availability topic and nothing for an ungated one", () => {
    registerMapPoiProvider({
      id: "gated",
      requires: "fake-domain",
      usePois: () => [],
    });
    registerMapPoiProvider({
      id: "ungated",
      usePois: () => [],
    });
    const fixture = setupStreamFixture({ pinnedUt: 0, suspendFrames: true });
    const subscribe = vi.spyOn(fixture.client, "subscribe");

    const view = render(
      <fixture.Provider>
        <MapPoiLayer bodyId="Kerbin" project={project} />
      </fixture.Provider>,
    );
    renderedTrees.push(view.unmount);

    const topics = subscribe.mock.calls.map(([topic]) => topic);
    expect(topics).toContain("fake-domain.available");
    expect(topics).not.toContain("");
  });

  it("shows label, detail and formatted coordinates in a hover card on marker hover", () => {
    vi.useFakeTimers();
    registerMapPoiProvider({
      id: "vanilla:test",
      usePois: () => [
        makePoi({
          id: "poi-1",
          label: "Runway",
          detail: "Launch pad",
          lat: -0.0486,
          lon: -74.72,
        }),
      ],
    });

    renderLayer();

    expect(screen.queryByText("Launch pad")).toBeNull();

    fireEvent.mouseEnter(screen.getByRole("button", { name: "Runway" }));

    expect(screen.getByText("Runway")).toBeInTheDocument();
    expect(screen.getByText("Launch pad")).toBeInTheDocument();
    expect(visibleText()).toMatch(/-0\.05.*-74\.72/);

    fireEvent.mouseLeave(screen.getByRole("button", { name: "Runway" }));
    act(() => {
      vi.advanceTimersByTime(CARD_GRACE);
    });
    expect(screen.queryByText("Launch pad")).toBeNull();
  });

  describe("reaching the hover card's buttons", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    const run = vi.fn();
    function registerRunway() {
      registerMapPoiProvider({
        id: "vanilla:test",
        usePois: () => [
          makePoi({
            id: "poi-1",
            label: "Runway",
            detail: "Launch pad",
            actions: [{ id: "set-target", label: "Set as Target", run }],
          }),
        ],
      });
    }

    it("keeps the card open while the pointer crosses from the marker to it", () => {
      registerRunway();
      renderLayer();
      const marker = screen.getByRole("button", { name: "Runway" });

      fireEvent.mouseEnter(marker);
      fireEvent.mouseLeave(marker);
      act(() => {
        vi.advanceTimersByTime(CARD_GRACE - 1);
      });
      fireEvent.mouseEnter(
        screen.getByRole("group", { name: "Runway details" }),
      );
      act(() => {
        vi.advanceTimersByTime(CARD_GRACE * 4);
      });

      expect(
        screen.getByRole("button", { name: "Set as Target" }),
      ).toBeVisible();
    });

    it("closes once the pointer leaves the card", () => {
      registerRunway();
      renderLayer();
      const marker = screen.getByRole("button", { name: "Runway" });

      fireEvent.mouseEnter(marker);
      const card = screen.getByRole("group", { name: "Runway details" });
      fireEvent.mouseEnter(card);
      fireEvent.mouseLeave(card);
      act(() => {
        vi.advanceTimersByTime(CARD_GRACE);
      });

      expect(screen.queryByText("Launch pad")).toBeNull();
    });

    it("reaches the card's button with Tab from the marker, and Escape closes it back onto the marker", () => {
      registerRunway();
      renderLayer();
      const marker = screen.getByRole("button", { name: "Runway" });

      act(() => marker.focus());
      fireEvent.keyDown(marker, { key: "Tab" });
      const action = screen.getByRole("button", { name: "Set as Target" });
      expect(action).toHaveFocus();
      act(() => {
        vi.advanceTimersByTime(CARD_GRACE * 4);
      });
      expect(action).toBeVisible();

      fireEvent.keyDown(action, { key: "Escape" });
      expect(screen.queryByText("Launch pad")).toBeNull();
      expect(marker).toHaveFocus();
    });

    it("returns focus to the marker on Shift+Tab from the first control", () => {
      registerRunway();
      renderLayer();
      const marker = screen.getByRole("button", { name: "Runway" });

      act(() => marker.focus());
      fireEvent.keyDown(marker, { key: "Tab" });
      fireEvent.keyDown(screen.getByRole("button", { name: "Set as Target" }), {
        key: "Tab",
        shiftKey: true,
      });

      expect(marker).toHaveFocus();
    });
  });

  it("renders every meta entry as a key/value row in the hover card", () => {
    registerMapPoiProvider({
      id: "vanilla:test",
      usePois: () => [
        makePoi({
          id: "poi-1",
          label: "Recover the flag",
          kind: "contractTarget",
          status: "active",
          meta: { agent: "Kerbin Space Agency", fundsAdvance: 1000 },
        }),
      ],
    });

    renderLayer();

    fireEvent.mouseEnter(
      screen.getByRole("button", { name: "Recover the flag" }),
    );

    expect(screen.getByText("Kerbin Space Agency")).toBeInTheDocument();
    expect(visibleText()).toContain("1000");
  });

  it("dispatches a POI's action when its hover-card button is clicked", () => {
    const run = vi.fn();
    registerMapPoiProvider({
      id: "vanilla:test",
      usePois: () => [
        makePoi({
          id: "poi-1",
          label: "Runway",
          actions: [{ id: "set-target", label: "Set as Target", run }],
        }),
      ],
    });

    renderLayer();

    fireEvent.mouseEnter(screen.getByRole("button", { name: "Runway" }));
    fireEvent.click(screen.getByRole("button", { name: "Set as Target" }));

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("falls back to a neutral style for an unrecognised kind instead of throwing", () => {
    registerMapPoiProvider({
      id: "third-party",
      usePois: () => [
        makePoi({ id: "mystery", label: "Mystery", kind: "third-party-thing" }),
      ],
    });

    renderLayer();

    expect(screen.getByRole("button", { name: "Mystery" })).toBeInTheDocument();
  });

  it("renders nothing extra when no providers are registered", () => {
    const { container } = renderLayer();

    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(container.querySelectorAll("*").length).toBeGreaterThan(0);
  });

  it("a11y smoke: markers + open hover card have no violations", async () => {
    registerMapPoiProvider({
      id: "vanilla:test",
      usePois: () => [
        makePoi({
          id: "poi-1",
          label: "Runway",
          detail: "Launch pad",
          actions: [
            { id: "set-target", label: "Set as Target", run: () => {} },
          ],
        }),
      ],
    });

    const { container } = renderLayer();

    fireEvent.mouseEnter(screen.getByRole("button", { name: "Runway" }));

    await expectNoA11yViolations(container);
  });
});
