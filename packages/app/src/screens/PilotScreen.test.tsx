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

function renderPilot() {
  return render(
    <ErrorBoundary>
      <ModalProvider>
        <PilotScreen code="5RML48" />
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
  it("waits on the join view, naming its code, until the host approves it", () => {
    renderPilot();
    expect(screen.getByText("Reaching the host")).toBeInTheDocument();
    expect(screen.getByText("5RML48")).toBeInTheDocument();
    expect(screen.queryByRole("main", { name: "Mission control" })).toBeNull();
  });

  it("hands each Uplink a broker through the host, as a station screen does", async () => {
    const attach = vi.fn();
    registerStationBroker("probe", attach);
    renderPilot();
    await waitFor(() => expect(attach).toHaveBeenCalledTimes(1));
    expect(attach.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ relay: expect.any(Function) }),
    );
  });

  it("offers the way back to the seats on the join page", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    try {
      renderPilot();
      await userEvent.click(
        screen.getByRole("button", { name: "Choose another seat" }),
      );
      expect(assign).toHaveBeenCalledWith("/join?5RML48");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
