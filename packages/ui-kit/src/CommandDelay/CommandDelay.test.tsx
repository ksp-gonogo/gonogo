import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { CommandDelay, type CommandDelayHandle } from "./CommandDelay";
import type { ControlStreamDatum } from "./ControlDelayStream";
import type { InFlightCommandLike } from "./toInFlightListItems";

const IN_FLIGHT: InFlightCommandLike[] = [
  {
    id: "a",
    label: "Launch",
    command: "ksp.launch",
    reachEtaSeconds: 5,
    replyEtaSeconds: 9,
    predictedPhase: "in-transit",
  },
];

const STREAM: ControlStreamDatum = {
  id: "throttle",
  label: "Throttle",
  oneWaySeconds: 1.6,
  inTransit: [{ age: 0, value: 0.5 }],
  echo: [{ age: 3.2, value: 0.4 }],
  current: 0.5,
};

describe("CommandDelay", () => {
  it("renders nothing at zero effective delay (meta-vantage / instant)", () => {
    const handle: CommandDelayHandle = {
      inFlight: [],
      shape: "discrete",
      effectiveDelaySeconds: 0,
    };
    const { container } = render(<CommandDelay handle={handle} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing at zero delay even for a stream command", () => {
    const handle: CommandDelayHandle = {
      inFlight: [],
      shape: "stream",
      effectiveDelaySeconds: 0,
      streams: [STREAM],
    };
    const { container } = render(<CommandDelay handle={handle} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the discrete in-flight list for a delayed discrete command", () => {
    const handle: CommandDelayHandle = {
      inFlight: IN_FLIGHT,
      shape: "discrete",
      effectiveDelaySeconds: 5,
    };
    render(<CommandDelay handle={handle} ariaLabel="Launch: in flight" />);
    expect(screen.getByLabelText(/Launch: in flight/)).toBeInTheDocument();
  });

  it("renders the control-delay stream for a delayed stream command", () => {
    const handle: CommandDelayHandle = {
      inFlight: [],
      shape: "stream",
      effectiveDelaySeconds: 1.6,
      streams: [STREAM],
    };
    render(<CommandDelay handle={handle} ariaLabel="Throttle in flight" />);
    expect(
      screen.getByRole("img", { name: "Throttle in flight" }),
    ).toBeInTheDocument();
  });

  it("has no accessibility violations when rendering the discrete list", async () => {
    const handle: CommandDelayHandle = {
      inFlight: IN_FLIGHT,
      shape: "discrete",
      effectiveDelaySeconds: 5,
    };
    const { container } = render(<CommandDelay handle={handle} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
