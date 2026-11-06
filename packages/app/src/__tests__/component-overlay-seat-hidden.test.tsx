/**
 * The picker keeps ground instruments off a pilot's screen. A count beside the
 * widget total says how many it left out, and its tooltip names them.
 */

import {
  clearRegistry,
  registerComponent,
  ScreenProvider,
} from "@ksp-gonogo/core";
import { SerialDeviceProvider, SerialDeviceService } from "@ksp-gonogo/serial";
import { render, screen } from "@ksp-gonogo/test-utils";
import { ModalProvider } from "@ksp-gonogo/ui";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import {
  ComponentOverlay,
  OverlayProvider,
} from "../components/ComponentOverlay";

function Stub() {
  return <div>stub</div>;
}

function register() {
  registerComponent({
    id: "ground-only",
    name: "Ground Only",
    description: "Offered to mission control only.",
    tags: ["telemetry"],
    component: Stub,
    seats: ["mission-control"],
  });
  registerComponent({
    id: "everywhere",
    name: "Everywhere",
    description: "Offered on both seats.",
    tags: ["telemetry"],
    component: Stub,
  });
}

async function openPicker(screenName: "main" | "pilot") {
  const serialService = new SerialDeviceService({ screenKey: "test" });
  render(
    <ScreenProvider value={screenName}>
      <ModalProvider>
        <SerialDeviceProvider service={serialService}>
          <OverlayProvider addItems={() => {}} updateItemConfig={() => {}}>
            <ComponentOverlay />
          </OverlayProvider>
        </SerialDeviceProvider>
      </ModalProvider>
    </ScreenProvider>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Add widget" }));
}

describe("ComponentOverlay: widgets kept off a seat", () => {
  afterEach(() => clearRegistry());

  it("counts the widgets a pilot is not offered, and names them on hover", async () => {
    register();
    await openPicker("pilot");
    const chip = screen.getByText(/^\d+ hidden$/);
    await userEvent.hover(chip);
    expect(await screen.findByText(/Ground Only/)).toBeInTheDocument();
  });

  it("shows no count on mission control, which is offered everything", async () => {
    register();
    await openPicker("main");
    expect(screen.queryByText(/hidden/)).toBeNull();
  });
});
