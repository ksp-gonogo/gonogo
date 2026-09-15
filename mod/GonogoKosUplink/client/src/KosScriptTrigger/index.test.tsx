/**
 * Integration proof for the kOS Script Trigger widget: the REAL component,
 * the REAL `useStream("kos.processors")` CPU read, and the REAL
 * `kosSource.executeScript` dispatch → correlate → resolve pipeline, over a
 * REAL `TelemetryProvider`. Nothing internal is mocked: only the wire is
 * faked, via `FakeKosUplink` (the same `StubTransport`-backed responder the
 * executeScript / CPU-discovery integration tests use).
 */

import {
  act,
  fireEvent,
  render,
  screen,
  TelemetryProvider,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { FakeKosUplink } from "../dataSource/__fixtures__/FakeKosUplink";
import { kosSource } from "../dataSource/kos";
import { KosScriptTriggerComponent } from "./index";

const CARRIED = ["kos.processors", "comms.delay"];

function renderWidget(config: { cpuName?: string; scriptPath?: string } = {}) {
  const fake = FakeKosUplink.install();
  const utils = render(
    <TelemetryProvider client={fake.client} carriedChannels={CARRIED}>
      <KosScriptTriggerComponent id="kos-script-trigger-1" config={config} />
    </TelemetryProvider>,
  );
  return { fake, ...utils };
}

describe("KosScriptTrigger", () => {
  afterEach(() => {
    kosSource.disconnect();
    FakeKosUplink.uninstall();
    localStorage.clear();
  });

  it("dispatches the script with typed args and shows the correlated result", async () => {
    const { fake } = renderWidget();
    fake.setCpus([{ number: 7, tagname: "lander" }]);
    fake.registerScript(
      "0:/deltav.ks",
      (inv) => `[KOSDATA] dv=${inv.args[0]};ok=true [/KOSDATA]`,
    );

    // The sole CPU auto-selects: its tagname shows up as the target.
    await waitFor(() => expect(screen.getByText("lander")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Script path"), {
      target: { value: "0:/deltav.ks" },
    });
    fireEvent.change(screen.getByLabelText("Arguments"), {
      target: { value: "42" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => expect(screen.getByText("OK")).toBeInTheDocument());
    // The parsed [KOSDATA] fields are surfaced inline.
    expect(screen.getByText("dv")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("ok")).toBeInTheDocument();

    // The number arg reached the script as a bare number, not a quoted string.
    const [invocation] = fake.invocations();
    expect(invocation.script).toBe("0:/deltav.ks");
    expect(invocation.args).toEqual(["42"]);
  });

  it("surfaces a script-author fault as a script error, inline", async () => {
    const { fake } = renderWidget();
    fake.setCpus([{ number: 7, tagname: "lander" }]);
    fake.registerScript(
      "0:/bad.ks",
      () => "[KOSERROR]undefined variable FOO[/KOSERROR]",
    );

    await waitFor(() => expect(screen.getByText("lander")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Script path"), {
      target: { value: "0:/bad.ks" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() =>
      expect(screen.getByText("Script error")).toBeInTheDocument(),
    );
    expect(screen.getByText(/undefined variable FOO/)).toBeInTheDocument();
  });

  it("offers a CPU picker and dispatches to the picked CPU when several are present", async () => {
    const { fake } = renderWidget();
    fake.setCpus([
      { number: 7, tagname: "lander" },
      { number: 9, tagname: "probe" },
    ]);
    fake.registerScript("0:/ping.ks", () => "[KOSDATA] pong=1 [/KOSDATA]");

    const select = await screen.findByLabelText("CPU");
    fireEvent.change(select, { target: { value: "probe" } });
    fireEvent.change(screen.getByLabelText("Script path"), {
      target: { value: "0:/ping.ks" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => expect(screen.getByText("OK")).toBeInTheDocument());
    expect(fake.invocations()[0].cpu.tagname).toBe("probe");
  });

  it("degrades gracefully before kos.processors has reported: Run is disabled and the silence is named", async () => {
    renderWidget();
    // No setCpus(): the channel has said NOTHING. That is not evidence the
    // vessel carries no CPU, so the copy must not claim it is.
    await waitFor(() =>
      expect(screen.getByText(/kos\.processors/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/No kOS CPU available/)).toBeNull();
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
  });

  it("degrades gracefully with a reported-empty CPU list: Run is disabled and a clear reason is shown", async () => {
    const { fake } = renderWidget();
    fake.setCpus([]);
    await waitFor(() =>
      expect(screen.getByText(/No kOS CPU available/)).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
  });

  /*
   * The round-trip chip beside Run had no coverage at all: no match for
   * `comms.delay`, `round-trip` or `oneWay` anywhere in this file. It reads a
   * WRAPPED `Value<"s">`, and nothing here would have noticed the widget
   * reaching for the wrong field of it, or quoting the one-way figure where
   * the operator waits out two.
   */
  it("quotes the DOUBLED round-trip beside Run when a one-way delay is being published", async () => {
    const { fake } = renderWidget();
    fake.setCpus([{ number: 7, tagname: "lander" }]);
    await waitFor(() => expect(screen.getByText("lander")).toBeInTheDocument());

    act(() =>
      fake.transport.emit("comms.delay", {
        oneWaySeconds: 3.8,
        source: "SignalDelay",
      }),
    );

    const chip = await screen.findByLabelText("Signal round-trip");
    // 2 x 3.8, the wait the operator actually sits through: dispatch out and
    // result back.
    expect(chip.textContent).toContain("7.6");
  });

  it("draws no round-trip chip when nothing is publishing a delay, and says so for a measured zero", async () => {
    const { fake } = renderWidget();
    fake.setCpus([{ number: 7, tagname: "lander" }]);
    await waitFor(() => expect(screen.getByText("lander")).toBeInTheDocument());

    // Nothing on comms.delay: no figure exists, so none is quoted.
    expect(screen.queryByLabelText("Signal round-trip")).toBeNull();

    // A measured zero is a different fact from silence: the link IS instant,
    // and the operator is told so rather than shown the same blank.
    act(() =>
      fake.transport.emit("comms.delay", {
        oneWaySeconds: 0,
        source: "NoCommsModel",
      }),
    );

    const chip = await screen.findByLabelText("Signal round-trip");
    expect(chip.textContent).toContain("instant");
  });

  it("has no accessibility violations", async () => {
    const { fake, container } = renderWidget();
    fake.setCpus([{ number: 7, tagname: "lander" }]);
    await waitFor(() => expect(screen.getByText("lander")).toBeInTheDocument());
    await expectNoA11yViolations(container);
  });
});
