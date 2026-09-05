import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import type { Layouts } from "react-grid-layout";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardItem } from "../components/Dashboard";
import { MissionProfilesProvider } from "./MissionProfilesContext";
import { MissionProfilesModal } from "./MissionProfilesModal";
import { MissionProfilesService } from "./MissionProfilesService";

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

const ITEMS: DashboardItem[] = [{ i: "a", componentId: "fuel-status" }];
const LAYOUTS: Layouts = {
  lg: [{ i: "a", x: 0, y: 0, w: 8, h: 14, moved: false, static: false }],
};

const NOW = 1_700_000_000_000;
const HOUR_MS = 3_600_000;

function renderWithProfileAgedBy(ms: number) {
  const svc = new MissionProfilesService("main", memoryStorage());
  vi.spyOn(Date, "now").mockReturnValue(NOW - ms);
  svc.save("Launch", ITEMS, LAYOUTS);
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  return render(
    <MissionProfilesProvider service={svc}>
      <MissionProfilesModal
        currentItems={ITEMS}
        currentLayouts={LAYOUTS}
        onLoad={() => {}}
      />
    </MissionProfilesProvider>,
  );
}

describe("MissionProfilesModal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * The age is split across elements by `Unit` (magnitude, thin space, symbol),
   * so the assertion reads `textContent` rather than matching a single text
   * node.
   */
  function metaText(): string {
    const name = screen.getByText("Launch");
    const header = name.parentElement;
    if (!header) throw new Error("profile header not found");
    return header.textContent ?? "";
  }

  it("ages a saved profile on the WALL-CLOCK ladder, not the game one", () => {
    renderWithProfileAgedBy(26 * HOUR_MS);
    const text = metaText();
    // 26 real hours is 1d 2h on a 24-hour day. On the game ladder, where a
    // Kerbin day is six hours, the same stamp would read "4d 2h".
    expect(text).toContain("1d 2h");
    expect(text).not.toContain("4d");
    expect(text).toContain("ago");
  });

  it("still renders the widget count beside the age", () => {
    renderWithProfileAgedBy(90_000);
    expect(metaText()).toContain("1 widget");
    expect(metaText()).toContain("1min 30s");
  });
});
