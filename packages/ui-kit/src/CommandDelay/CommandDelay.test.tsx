import { describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { render, screen } from "../testing-react";
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

  it('forwards variant="rail" to the stream branch; defaults to inline', () => {
    const handle: CommandDelayHandle = {
      inFlight: [],
      shape: "stream",
      effectiveDelaySeconds: 1.6,
      streams: [STREAM],
    };
    const { container: rail } = render(
      <CommandDelay handle={handle} variant="rail" />,
    );
    expect(rail.querySelector("[data-variant]")).toHaveAttribute(
      "data-variant",
      "rail",
    );
    const { container: inline } = render(<CommandDelay handle={handle} />);
    expect(inline.querySelector("[data-variant]")).toHaveAttribute(
      "data-variant",
      "inline",
    );
  });

  it('forwards variant="rail" to the discrete branch (v3 height-graph strip)', () => {
    const handle: CommandDelayHandle = {
      inFlight: IN_FLIGHT,
      shape: "discrete",
      effectiveDelaySeconds: 5,
    };
    const { container } = render(
      <CommandDelay
        handle={handle}
        variant="rail"
        ariaLabel="Launch: in flight"
      />,
    );
    // The rail strip is an <svg role="img"> glow band, not the monospace list.
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector('[data-role="glow"]')).not.toBeNull();
  });

  it("merges the in-flight rows of several discrete handles into one list", () => {
    const handles: CommandDelayHandle[] = [
      {
        inFlight: [{ ...IN_FLIGHT[0], id: "add", label: "Add node" }],
        shape: "discrete",
        effectiveDelaySeconds: 5,
      },
      {
        inFlight: [{ ...IN_FLIGHT[0], id: "remove", label: "Remove node" }],
        shape: "discrete",
        effectiveDelaySeconds: 5,
      },
    ];
    render(<CommandDelay handles={handles} ariaLabel="Nodes in flight" />);
    const region = screen.getByLabelText(/Nodes in flight/);
    expect(region).toHaveTextContent("Add node");
    expect(region).toHaveTextContent("Remove node");
  });

  it("renders when only one of several handles has a delay", () => {
    const handles: CommandDelayHandle[] = [
      { inFlight: [], shape: "discrete", effectiveDelaySeconds: 0 },
      {
        inFlight: [IN_FLIGHT[0]],
        shape: "discrete",
        effectiveDelaySeconds: 5,
      },
    ];
    const { container } = render(<CommandDelay handles={handles} />);
    expect(container).not.toBeEmptyDOMElement();
  });

  it("marks every handle's must-consume token on mount (dev)", () => {
    const a: CommandDelayHandle = {
      inFlight: [],
      shape: "discrete",
      effectiveDelaySeconds: 0,
      _output: { consumed: false },
    };
    const b: CommandDelayHandle = {
      inFlight: [],
      shape: "stream",
      effectiveDelaySeconds: 0,
      streams: [STREAM],
      _output: { consumed: false },
    };
    render(<CommandDelay handles={[a, b]} />);
    // Marked even though both render nothing (instant): no exemption path.
    expect(a._output?.consumed).toBe(true);
    expect(b._output?.consumed).toBe(true);
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
