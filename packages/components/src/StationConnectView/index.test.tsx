import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { axe } from "../test/axe";
import {
  describeConnStatus,
  StationConnectView,
  statusTone,
} from "./index";

const baseProps = {
  hostInput: "",
  connStatus: "idle" as const,
  hostNotFound: false,
  everConnected: false,
  onHostInputChange: () => {},
  onConnect: () => {},
  onDownloadLogs: () => {},
};

describe("StationConnectView", () => {
  it("renders the connect prompt with an accessible host input and connect button", () => {
    render(<StationConnectView {...baseProps} />);
    expect(screen.getByText(/Connect to Mission Control/i)).not.toBeNull();
    expect(screen.getByLabelText(/host id/i)).not.toBeNull();
    expect(
      screen.getByRole("button", { name: /connect/i }),
    ).not.toBeNull();
  });

  it("calls onConnect on button click and onHostInputChange on typing", async () => {
    const onConnect = vi.fn();
    const onHostInputChange = vi.fn();
    render(
      <StationConnectView
        {...baseProps}
        hostInput="AB3K"
        onConnect={onConnect}
        onHostInputChange={onHostInputChange}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^connect$/i }));
    expect(onConnect).toHaveBeenCalledWith("AB3K");

    // Typing into the input forwards each change.
    await userEvent.type(screen.getByLabelText(/host id/i), "Z");
    expect(onHostInputChange).toHaveBeenCalled();
  });

  it("disables the connect button and shows the connecting label while connecting", () => {
    render(<StationConnectView {...baseProps} connStatus="connecting" />);
    const button = screen.getByRole("button", { name: /connecting/i });
    expect(button.getAttribute("disabled")).not.toBeNull();
  });

  it("shows the hard not-found error when never connected", () => {
    render(
      <StationConnectView
        {...baseProps}
        hostInput="ZZ9Q"
        connStatus="disconnected"
        hostNotFound
      />,
    );
    expect(screen.getByText(/Couldn't find code/i)).not.toBeNull();
    expect(screen.getByText(/ZZ9Q/)).not.toBeNull();
  });

  it("shows the softer reconnect notice once previously connected", () => {
    render(
      <StationConnectView
        {...baseProps}
        connStatus="reconnecting"
        hostNotFound
        everConnected
      />,
    );
    // The reconnect notice is a polite live region. Both it and the
    // StatusIndicator expose role=status, so match by text.
    expect(
      screen.getByText(/Host reconnecting… The main screen is restarting/i),
    ).not.toBeNull();
  });

  it("renders the injected name editor slot", () => {
    render(
      <StationConnectView
        {...baseProps}
        nameEditor={<span data-testid="name-slot">slot</span>}
      />,
    );
    expect(screen.getByTestId("name-slot")).not.toBeNull();
  });

  it("fires onDownloadLogs from the diagnostics button", async () => {
    const onDownloadLogs = vi.fn();
    render(
      <StationConnectView {...baseProps} onDownloadLogs={onDownloadLogs} />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /download logs/i }),
    );
    expect(onDownloadLogs).toHaveBeenCalledTimes(1);
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <StationConnectView
        {...baseProps}
        nameEditor={<span>Station name: LFV-1b</span>}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("connect status helpers", () => {
  it("describes the never-connected not-found state distinctly from reconnect", () => {
    expect(describeConnStatus("disconnected", true, false)).toMatch(
      /Broker doesn't know that code/i,
    );
    expect(describeConnStatus("reconnecting", true, true)).toMatch(
      /Host reconnecting/i,
    );
  });

  it("tones a never-connected dead code nogo but a reclaim window info", () => {
    expect(statusTone("disconnected", true, false)).toBe("nogo");
    expect(statusTone("reconnecting", true, true)).toBe("info");
    expect(statusTone("connected", false, true)).toBe("go");
    expect(statusTone("idle", false, false)).toBe("neutral");
  });
});
