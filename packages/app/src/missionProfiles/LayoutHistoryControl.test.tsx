import { act, fireEvent, render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import type { Layout } from "react-grid-layout";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardItem } from "../components/Dashboard";
import { LayoutHistoryControl } from "./LayoutHistoryControl";
import { MissionProfilesProvider } from "./MissionProfilesContext";
import { MissionProfilesService } from "./MissionProfilesService";
import { AUTOSAVE_DELAY_MS, ProfileDashboard } from "./ProfileDashboard";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    length: 0,
    clear: () => map.clear(),
    key: () => null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, String(v));
    },
    removeItem: (k) => {
      map.delete(k);
    },
  } as Storage;
}

const widget = (i: string): DashboardItem => ({
  i,
  componentId: "fuel-status",
});
const tile = (i: string): Layout[number] => ({
  i,
  x: 0,
  y: 0,
  w: 4,
  h: 4,
  moved: false,
  static: false,
});

function setup() {
  const svc = new MissionProfilesService("main", memoryStorage());
  svc.setCurrent(svc.save("Ascent", [], []).id);
  const dashboard = new ProfileDashboard(svc, () => {}, {
    items: [],
    layout: [],
  });
  const stop = dashboard.attach();
  const { container } = render(
    <MissionProfilesProvider service={svc}>
      <LayoutHistoryControl dashboard={dashboard} />
    </MissionProfilesProvider>,
  );
  return { dashboard, stop, container };
}

const disabled = (name: string) =>
  (screen.getByRole("button", { name }) as HTMLButtonElement).disabled;

describe("LayoutHistoryControl", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("names the layout and offers Undo and Redo disabled with nothing to step through", () => {
    const { stop } = setup();
    expect(screen.getByText("Ascent")).toBeTruthy();
    expect(disabled("Undo")).toBe(true);
    expect(disabled("Redo")).toBe(true);
    stop();
  });

  it("enables Undo with the step it covers, and Redo once something was undone", () => {
    const { dashboard, stop } = setup();
    act(() => {
      vi.advanceTimersByTime(1000);
      dashboard.recordChange([widget("a")], [tile("a")]);
      vi.advanceTimersByTime(AUTOSAVE_DELAY_MS + 1);
    });
    expect(disabled("Undo layout change")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Undo layout change" }));
    expect(disabled("Redo layout change")).toBe(false);
    expect(disabled("Undo")).toBe(true);
    stop();
  });

  it("has no accessibility violations", async () => {
    vi.useRealTimers();
    const { stop, container } = setup();
    await expectNoA11yViolations(container);
    stop();
  });
});
