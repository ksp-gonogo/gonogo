import { SerialDeviceProvider, SerialDeviceService } from "@ksp-gonogo/serial";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { ModalProvider } from "@ksp-gonogo/ui";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { analyticsConsentService } from "../../analytics/AnalyticsConsentService";
import { ComponentOverlay, OverlayProvider } from "../ComponentOverlay";
import { Dashboard } from "./index";

const NOOP = vi.fn();

function dashboard(items: Parameters<typeof Dashboard>[0]["items"]) {
  return (
    <Dashboard
      items={items}
      layout={[]}
      onLayoutChange={NOOP}
      updateItemConfig={NOOP}
      updateItemMappings={NOOP}
      updateItemMobileWidth={NOOP}
      updateItemMobileHeight={NOOP}
      removeItem={NOOP}
      moveItemUp={NOOP}
      moveItemDown={NOOP}
    />
  );
}

function renderDashboard(items: Parameters<typeof Dashboard>[0]["items"]) {
  return render(dashboard(items));
}

/** The dashboard as a screen mounts it, beside the picker its button opens. */
function renderScreen(items: Parameters<typeof Dashboard>[0]["items"]) {
  return render(
    <ModalProvider>
      <SerialDeviceProvider
        service={new SerialDeviceService({ screenKey: "test" })}
      >
        <OverlayProvider addItem={NOOP} updateItemConfig={NOOP}>
          {dashboard(items)}
          <ComponentOverlay />
        </OverlayProvider>
      </SerialDeviceProvider>
    </ModalProvider>,
  );
}

describe("Dashboard with no widgets", () => {
  afterEach(() => localStorage.clear());

  it("offers a switch for anonymous analytics, off until it is turned on", async () => {
    renderScreen([]);
    const toggle = screen.getByRole("checkbox", {
      name: "Send technical analytics",
    });
    expect(toggle).not.toBeChecked();
    expect(analyticsConsentService.isEnabled()).toBe(false);

    await userEvent.setup().click(toggle);

    expect(toggle).toBeChecked();
    expect(analyticsConsentService.isEnabled()).toBe(true);
  });

  it("shows a setting already turned on in Settings", () => {
    analyticsConsentService.set("enabled");
    renderScreen([]);
    expect(
      screen.getByRole("checkbox", { name: "Send technical analytics" }),
    ).toBeChecked();
  });

  it("says so, with a button that opens the widget picker", async () => {
    const { container } = renderScreen([]);

    expect(screen.getByText("No widgets on this dashboard")).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "Add a widget" })).toBeNull();
    await expectNoA11yViolations(container);

    await act(async () => {
      screen.getByRole("button", { name: "Add a widget" }).click();
    });
    expect(screen.getByRole("dialog", { name: "Add a widget" })).toBeVisible();
  });

  it("shows no button where no picker is mounted to open", () => {
    renderDashboard([]);

    expect(screen.getByText("No widgets on this dashboard")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Add a widget" })).toBeNull();
  });

  it("shows no notice once a widget is placed", () => {
    renderDashboard([{ i: "a", componentId: "not-registered" }]);

    expect(screen.queryByText("No widgets on this dashboard")).toBeNull();
  });
});
