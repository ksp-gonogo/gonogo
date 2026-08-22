/**
 * Integration proof for the kOS Script Trigger widget: the REAL component,
 * the REAL `useStream("kos.processors")` CPU read, and the REAL
 * `kosSource.executeScript` dispatch → correlate → resolve pipeline, over a
 * REAL `TelemetryProvider`. Nothing internal is mocked: only the wire is
 * faked, via `FakeKosUplink` (the same `StubTransport`-backed responder the
 * executeScript / CPU-discovery integration tests use).
 */

import {
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

const CARRIED = ["kos.processors"];

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

  it("degrades gracefully with no CPU: Run is disabled and a clear reason is shown", async () => {
    renderWidget();
    // No setCpus(): the widget sees an empty processor list.
    await waitFor(() =>
      expect(screen.getByText(/No kOS CPU available/)).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
  });

  it("has no accessibility violations", async () => {
    const { fake, container } = renderWidget();
    fake.setCpus([{ number: 7, tagname: "lander" }]);
    await waitFor(() => expect(screen.getByText("lander")).toBeInTheDocument());
    await expectNoA11yViolations(container);
  });
});
