import { act, render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONNECT_STALL_MS,
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
    expect(screen.getByRole("button", { name: /connect/i })).not.toBeNull();
  });

  it("replaces the host input's stripped outline with a :focus-visible ring", () => {
    render(<StationConnectView {...baseProps} />);
    const input = screen.getByLabelText(/host id/i);
    const css = Array.from(document.querySelectorAll("style"))
      .map((el) => el.textContent ?? "")
      .join("\n");
    const inputClass = Array.from(input.classList).find((cls) =>
      css.includes(`.${cls}:focus-visible`),
    );
    expect(inputClass).toBeDefined();
    expect(css).toMatch(
      new RegExp(`\\.${inputClass}:focus-visible\\{[^}]*outline:2px solid`),
    );
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
    // Both the reconnect notice and the StatusIndicator are role=status, so match by text.
    expect(
      screen.getByText(/Host reconnecting... The main screen is restarting/i),
    ).not.toBeNull();
  });

  it("blames the broker, not the code, when this device can't reach the broker", () => {
    render(
      <StationConnectView
        {...baseProps}
        hostInput="ZZ9Q"
        connStatus="disconnected"
        hostNotFound
        brokerUnreachable
      />,
    );
    expect(
      screen.getByText(/needs a working internet connection/i),
    ).not.toBeNull();
    expect(
      screen.getByText(/this device needs internet access/i),
    ).not.toBeNull();
    // The code-is-wrong copy would send the operator to the main screen for a fault on this device's network.
    expect(screen.queryByText(/Couldn't find code/i)).toBeNull();
    expect(screen.queryByText(/Check the host ID/i)).toBeNull();
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
    await expectNoA11yViolations(container);
  });
});

describe("connect progress", () => {
  const T0 = 1_000_000;

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists the stage reached with its elapsed time and the attempt", () => {
    vi.useFakeTimers({ now: T0 + 4_000, toFake: ["Date", "setInterval"] });
    render(
      <StationConnectView
        {...baseProps}
        connStatus="connecting"
        progress={{
          startedAt: T0,
          attempt: 1,
          entered: { broker: T0, host: T0 + 800 },
        }}
      />,
    );
    const stages = screen.getByRole("list", { name: /connection stages/i });
    expect(stages.textContent).toContain("Brokerok, 0.8 s");
    expect(stages.textContent).toContain("Host channelwaiting, 3.2 s");
    expect(stages.textContent).toContain("Host datanot started");
    expect(stages.textContent).toContain("Elapsed4.0 s, attempt 1");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reports a stall naming the stage once the stall window passes", () => {
    vi.useFakeTimers({
      now: T0 + CONNECT_STALL_MS + 2_000,
      toFake: ["Date", "setInterval"],
    });
    render(
      <StationConnectView
        {...baseProps}
        connStatus="reconnecting"
        progress={{
          startedAt: T0,
          attempt: 7,
          entered: { broker: T0 + 31_000 },
        }}
      />,
    );
    expect(screen.getByRole("alert").textContent).toMatch(
      /No connection after 32 s\. Stalled at broker, attempt 7/,
    );
  });

  it("advances the elapsed time each second", () => {
    vi.useFakeTimers({ now: T0, toFake: ["Date", "setInterval"] });
    render(
      <StationConnectView
        {...baseProps}
        connStatus="connecting"
        progress={{ startedAt: T0, attempt: 1, entered: { broker: T0 } }}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(screen.getByRole("list").textContent).toContain("Elapsed3.0 s");
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

  it("ranks an unreachable broker above a missing host in both helpers", () => {
    expect(describeConnStatus("disconnected", true, false, true)).toMatch(
      /Can't reach the peer broker/i,
    );
    expect(statusTone("reconnecting", true, true, true)).toBe("nogo");
  });

  it("tones a never-connected dead code nogo but a reclaim window info", () => {
    expect(statusTone("disconnected", true, false)).toBe("nogo");
    expect(statusTone("reconnecting", true, true)).toBe("info");
    expect(statusTone("connected", false, true)).toBe("go");
    expect(statusTone("idle", false, false)).toBe("neutral");
  });
});
