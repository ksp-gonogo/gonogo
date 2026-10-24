import { SerialDeviceProvider, SerialDeviceService } from "@ksp-gonogo/serial";
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { ModalProvider } from "@ksp-gonogo/ui";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import type { Layout } from "react-grid-layout";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardItem } from "../components/Dashboard";
import { MissionProfilesProvider } from "./MissionProfilesContext";
import { MissionProfilesModal } from "./MissionProfilesModal";
import { MissionProfilesService } from "./MissionProfilesService";
import { ProfileDashboard } from "./ProfileDashboard";

const serialService = new SerialDeviceService({
  screenKey: "modal-test",
  renderDebounceMs: 0,
});

function dashboardFor(svc: MissionProfilesService) {
  return new ProfileDashboard(svc, () => {}, { items: ITEMS, layout: LAYOUT });
}

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
const LAYOUT: Layout = [
  { i: "a", x: 0, y: 0, w: 8, h: 14, moved: false, static: false },
];

const NOW = 1_700_000_000_000;
const HOUR_MS = 3_600_000;

function renderWithProfileAgedBy(ms: number) {
  const svc = new MissionProfilesService("main", memoryStorage());
  vi.spyOn(Date, "now").mockReturnValue(NOW - ms);
  svc.save("Launch", ITEMS, LAYOUT);
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  return render(
    <ModalProvider>
      <SerialDeviceProvider service={serialService}>
        <MissionProfilesProvider service={svc}>
          <MissionProfilesModal dashboard={dashboardFor(svc)} />
        </MissionProfilesProvider>
      </SerialDeviceProvider>
    </ModalProvider>,
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

  describe("switching and copying", () => {
    function renderTwo() {
      const svc = new MissionProfilesService("main", memoryStorage());
      const a = svc.save("Launch", ITEMS, LAYOUT);
      svc.save("Orbit", [], []);
      svc.setCurrent(a.id);
      const dashboard = dashboardFor(svc);
      const { container } = render(
        <ModalProvider>
          <SerialDeviceProvider service={serialService}>
            <MissionProfilesProvider service={svc}>
              <MissionProfilesModal dashboard={dashboard} />
            </MissionProfilesProvider>
          </SerialDeviceProvider>
        </ModalProvider>,
      );
      return { svc, a, container };
    }

    it("has no Overwrite control, since every change already saves", () => {
      renderTwo();
      expect(screen.queryByRole("button", { name: "Overwrite" })).toBeNull();
    });

    it("switches without asking, because nothing is lost by it", () => {
      const { svc } = renderTwo();
      const orbit = svc.list().find((p) => p.name === "Orbit");

      const enabled = screen
        .getAllByRole("button", { name: "Switch to" })
        .find((b) => !(b as HTMLButtonElement).disabled);
      if (!enabled) throw new Error("no layout to switch to");
      fireEvent.click(enabled);

      expect(svc.getCurrentId()).toBe(orbit?.id);
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("marks the current layout and cannot switch to it", () => {
      renderTwo();
      expect(screen.getAllByText(/Current/).length).toBeGreaterThan(0);
      const buttons = screen.getAllByRole("button", { name: "Switch to" });
      expect(
        buttons.filter((b) => (b as HTMLButtonElement).disabled),
      ).toHaveLength(1);
    });

    it("copies the dashboard under a name when started from this dashboard", () => {
      const { svc, a } = renderTwo();

      fireEvent.change(screen.getByPlaceholderText(/Launch, Orbit/), {
        target: { value: "Docking" },
      });
      fireEvent.click(screen.getByRole("button", { name: "This dashboard" }));
      fireEvent.click(screen.getByRole("button", { name: "Create layout" }));

      const copy = svc.list().find((p) => p.name === "Docking");
      expect(copy?.items).toEqual(ITEMS);
      expect(svc.getCurrentId()).toBe(copy?.id);
      expect(svc.get(a.id)?.name).toBe("Launch");
    });

    it("creates an empty layout in one step and shows it", () => {
      const { svc } = renderTwo();

      fireEvent.change(screen.getByPlaceholderText(/Launch, Orbit/), {
        target: { value: "Blank" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Create layout" }));

      const blank = svc.list().find((p) => p.name === "Blank");
      expect(blank?.items).toEqual([]);
      expect(blank?.layout).toEqual([]);
      expect(svc.getCurrentId()).toBe(blank?.id);
    });

    it("starts from a starter with its scenes and automatic switching on", () => {
      const { svc } = renderTwo();

      fireEvent.click(
        screen.getByRole("button", { name: "Space Centre starter" }),
      );
      expect(screen.getByPlaceholderText(/Launch, Orbit/)).toHaveValue(
        "Space Centre",
      );
      fireEvent.click(screen.getByRole("button", { name: "Create layout" }));

      const made = svc.list().find((p) => p.name === "Space Centre");
      expect(made?.items.length).toBeGreaterThan(0);
      expect(made?.sceneBindings).toEqual([
        "SpaceCenter",
        "TrackingStation",
        "Editor",
      ]);
      expect(made?.autoSwitch).toBe(true);
    });

    it("duplicates a layout under a copy name without its scenes", () => {
      const svc = new MissionProfilesService("main", memoryStorage());
      const launch = svc.save("Launch", ITEMS, LAYOUT, ["Flight"], true);
      svc.setCurrent(launch.id);
      render(
        <ModalProvider>
          <SerialDeviceProvider service={serialService}>
            <MissionProfilesProvider service={svc}>
              <MissionProfilesModal dashboard={dashboardFor(svc)} />
            </MissionProfilesProvider>
          </SerialDeviceProvider>
        </ModalProvider>,
      );

      fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));

      const copy = svc.list().find((p) => p.name === "Launch copy");
      expect(copy?.items).toEqual(ITEMS);
      expect(copy?.sceneBindings).toBeUndefined();
      expect(svc.getCurrentId()).toBe(copy?.id);
      expect(svc.get(launch.id)?.sceneBindings).toEqual(["Flight"]);
    });

    it("names the layout in the delete confirmation", () => {
      renderTwo();

      fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);

      expect(screen.getByRole("alert").textContent).toMatch(/^Delete \w+\?/);
    });

    it("has no accessibility violations", async () => {
      const { container } = renderTwo();
      await expectNoA11yViolations(container);
    });
  });

  describe("the input that switches to a layout", () => {
    function renderWithKey(bound: boolean) {
      const svc = new MissionProfilesService("main", memoryStorage());
      const launch = svc.save("Launch", ITEMS, LAYOUT);
      if (bound)
        svc.bindInput(launch.id, { deviceId: "keyboard", inputId: "KeyK" });
      render(
        <ModalProvider>
          <SerialDeviceProvider service={serialService}>
            <MissionProfilesProvider service={svc}>
              <MissionProfilesModal dashboard={dashboardFor(svc)} />
            </MissionProfilesProvider>
          </SerialDeviceProvider>
        </ModalProvider>,
      );
    }

    it("names the bound input in the player's words", () => {
      renderWithKey(true);

      expect(screen.getByText("Switch with: key K")).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Change input for Launch" }),
      ).toBeTruthy();
    });

    it("binds a pressed key to the layout and moves it from the layout that held it", async () => {
      const svc = new MissionProfilesService("main", memoryStorage());
      const launch = svc.save("Launch", ITEMS, LAYOUT);
      const orbit = svc.save("Orbit", ITEMS, LAYOUT);
      svc.bindInput(launch.id, { deviceId: "keyboard", inputId: "KeyK" });
      render(
        <ModalProvider>
          <SerialDeviceProvider service={serialService}>
            <MissionProfilesProvider service={svc}>
              <MissionProfilesModal dashboard={dashboardFor(svc)} />
            </MissionProfilesProvider>
          </SerialDeviceProvider>
        </ModalProvider>,
      );

      fireEvent.click(
        screen.getByRole("button", { name: "Set input for Orbit" }),
      );
      fireEvent.click(
        await screen.findByRole("button", {
          name: "Capture an input for Switch to this layout",
        }),
      );
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyK" }));
      });
      fireEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", {
          name: "Save",
        }),
      );

      expect(svc.get(orbit.id)?.inputBinding?.inputId).toBe("KeyK");
      expect(svc.get(launch.id)?.inputBinding).toBeUndefined();
      expect((await screen.findByText(/no longer to Launch/)).textContent).toBe(
        "key K now switches to Orbit, and no longer to Launch",
      );
    });

    it("offers to set one when none is bound", () => {
      renderWithKey(false);

      expect(screen.getByText("No input switches to this layout")).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Set input for Launch" }),
      ).toBeTruthy();
    });
  });

  describe("scenes", () => {
    function renderWithBound() {
      const svc = new MissionProfilesService("main", memoryStorage());
      svc.save("Launch", ITEMS, LAYOUT, ["SpaceCenter", "Editor"]);
      return render(
        <ModalProvider>
          <SerialDeviceProvider service={serialService}>
            <MissionProfilesProvider service={svc}>
              <MissionProfilesModal dashboard={dashboardFor(svc)} />
            </MissionProfilesProvider>
          </SerialDeviceProvider>
        </ModalProvider>,
      );
    }

    it("names scenes in player words and says a layout can follow several", () => {
      renderWithBound();

      expect(screen.getByText("Space Center")).toBeTruthy();
      expect(screen.getByText("Tracking Station")).toBeTruthy();
      expect(screen.queryByText("TrackingStation")).toBeNull();
      expect(screen.getByText(/can follow several scenes/)).toBeTruthy();
    });

    it("shows a saved row's bound scenes as text, not as four chips", () => {
      renderWithBound();

      expect(screen.getByText("Offered in: Space Center, Editor")).toBeTruthy();
      expect(screen.getAllByText("Editor")).toHaveLength(1);
    });
  });
});
