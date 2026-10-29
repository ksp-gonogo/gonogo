import { CommsDelaySource } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { TelemetryClient } from "./client";
import { TelemetryProvider } from "./context";
import { StubTransport } from "./stub-transport";
import { useCommand } from "./use-command";

const HOME = "ground:Kerbin: KSC";
const FORWARD = "vessel:forward";
const CRAFT = "vessel:92868329-cd07-e665-3ece-761f05a52c8c";

/** The active craft is four minutes from home, so any figure that is not 240 was not borrowed from it. */
const ACTIVE_CRAFT_DELAY = 240;

function Readout({ command, vantage }: { command: string; vantage?: string }) {
  const cmd = useCommand(command, vantage ? { vantage } : undefined);
  return (
    <span>
      {command}:{String(cmd.effectiveDelaySeconds)}
    </span>
  );
}

function setup(commands: { command: string; vantage?: string }[]) {
  const transport = new StubTransport();
  const client = new TelemetryClient(transport, undefined, { idPrefix: "t" });
  const view = render(
    <TelemetryProvider client={client}>
      {commands.map(({ command, vantage }) => (
        <Readout
          key={`${command}@${vantage}`}
          command={command}
          vantage={vantage}
        />
      ))}
    </TelemetryProvider>,
  );
  const emit = (topic: string, payload: unknown) =>
    act(() => {
      transport.emit(topic, payload);
    });
  emit("vessel.identity", { vesselId: "a" });
  emit("comms.delay", {
    oneWaySeconds: ACTIVE_CRAFT_DELAY,
    source: CommsDelaySource.SignalDelay,
    meta: { source: CRAFT },
  });
  return { emit, view };
}

const shown = (command: string) => screen.getByText(new RegExp(`^${command}:`));

describe("a command's delay is the delay to its own target", () => {
  it("times a career order by its delay to the home command, not by the active craft's", () => {
    const { emit, view } = setup([{ command: "career.tech.unlock" }]);
    emit("system.uplink.delays", {
      activeVessel: [],
      elsewhere: [
        {
          command: "career.tech.unlock",
          centre: HOME,
          oneWaySeconds: 0,
        },
      ],
    });
    expect(shown("career.tech.unlock").textContent).toBe(
      "career.tech.unlock:0",
    );
    view.unmount();
  });

  it("times a command to another craft by that craft's delay, unknown until the mod knows one", () => {
    const { emit, view } = setup([{ command: "fleet.vessel.order" }]);
    const report = (oneWaySeconds: unknown) => ({
      activeVessel: [],
      elsewhere: [
        { command: "fleet.vessel.order", centre: HOME, oneWaySeconds },
      ],
    });

    emit("system.uplink.delays", report(null));
    expect(shown("fleet.vessel.order").textContent).toBe(
      "fleet.vessel.order:null",
    );

    emit("system.uplink.delays", report(1500));
    expect(shown("fleet.vessel.order").textContent).toBe(
      "fleet.vessel.order:1500",
    );
    view.unmount();
  });

  it("times a command to the active craft sent from a forward centre by that centre's own delay", () => {
    const { emit, view } = setup([
      { command: "vessel.control.stage", vantage: FORWARD },
    ]);
    emit("system.uplink.delays", {
      activeVessel: ["vessel.control.stage"],
      elsewhere: [],
    });
    emit("commandCentre.activeVesselDelay", {
      centres: [{ id: FORWARD, oneWaySeconds: 30 }],
    });
    expect(shown("vessel.control.stage").textContent).toBe(
      "vessel.control.stage:30",
    );
    view.unmount();
  });

  it("knows no delay for a command the mod has not placed, rather than the active craft's", () => {
    const { view } = setup([{ command: "vessel.control.stage" }]);
    expect(shown("vessel.control.stage").textContent).toBe(
      "vessel.control.stage:null",
    );
    view.unmount();
  });

  it("knows no delay after a change of craft whose delay is withheld, rather than the old craft's", () => {
    const { emit, view } = setup([{ command: "vessel.control.stage" }]);
    emit("system.uplink.delays", {
      activeVessel: ["vessel.control.stage"],
      elsewhere: [],
    });
    expect(shown("vessel.control.stage").textContent).toBe(
      `vessel.control.stage:${ACTIVE_CRAFT_DELAY}`,
    );

    emit("vessel.identity", null);
    expect(shown("vessel.control.stage").textContent).toBe(
      "vessel.control.stage:null",
    );

    emit("vessel.identity", { vesselId: "b" });
    expect(shown("vessel.control.stage").textContent).toBe(
      "vessel.control.stage:null",
    );
    view.unmount();
  });
});
