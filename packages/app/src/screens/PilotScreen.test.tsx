import { clearRegistry, ErrorBoundary } from "@ksp-gonogo/core";
import {
  clearStationBrokers,
  registerStationBroker,
} from "@ksp-gonogo/sitrep-sdk";
import { render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { ModalProvider } from "@ksp-gonogo/ui";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PilotScreen } from "./PilotScreen";

vi.mock("peerjs", () => {
  class FakePeer {
    on() {
      return this;
    }
    connect() {
      return { on() {}, close() {}, open: false };
    }
    destroy() {}
    disconnect() {}
  }
  return { default: FakePeer, Peer: FakePeer };
});

const HOST_ID_KEY = "gonogo-station-host-id";

function renderPilot() {
  return render(
    <ErrorBoundary>
      <ModalProvider>
        <PilotScreen />
      </ModalProvider>
    </ErrorBoundary>,
  );
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  clearStationBrokers();
  clearRegistry();
  localStorage.clear();
});

describe("PilotScreen", () => {
  it("asks for the host code when none is saved", () => {
    renderPilot();
    expect(screen.getByLabelText("Join code")).toBeInTheDocument();
  });

  it("keeps the join code field open while the code is typed", async () => {
    renderPilot();

    const input = await screen.findByLabelText("Join code");
    await userEvent.type(input, "5RML48");

    expect(screen.getByLabelText("Join code")).toHaveValue("5RML48");
  });

  it("hands each Uplink a broker through the host, as a station screen does", async () => {
    const attach = vi.fn();
    registerStationBroker("probe", attach);
    localStorage.setItem(HOST_ID_KEY, "5RML48");
    renderPilot();
    await waitFor(() => expect(attach).toHaveBeenCalledTimes(1));
    expect(attach.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ relay: expect.any(Function) }),
    );
  });

  it("lets a saved host code be changed from the page", async () => {
    localStorage.setItem(HOST_ID_KEY, "OLDCODE");
    renderPilot();

    await userEvent.click(
      await screen.findByRole("button", { name: "Change code" }),
    );

    const input = await screen.findByLabelText("Join code");
    expect(input).toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, "newcode{enter}");
    await waitFor(() =>
      expect(localStorage.getItem(HOST_ID_KEY)).toBe("NEWCODE"),
    );
  });
});
