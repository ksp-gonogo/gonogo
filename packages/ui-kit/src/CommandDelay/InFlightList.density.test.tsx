import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { InFlightList, type InFlightListItem } from "./InFlightList";

const ITEMS: InFlightListItem[] = [
  {
    id: "a",
    label: "Engage ascent autopilot",
    etaSeconds: 160,
    phase: "in-transit",
  },
  { id: "b", label: "Execute next node", etaSeconds: 95, phase: "in-transit" },
];

// Density changes what the list paints, never what it knows: a screen reader hears the same thing at every size.
describe("InFlightList density", () => {
  it("prints label and countdown per command when there is room", () => {
    render(<InFlightList items={ITEMS} density="full" />);
    expect(screen.getByText("Engage ascent autopilot")).toBeInTheDocument();
    expect(screen.getByText("Execute next node")).toBeInTheDocument();
  });

  it("drops the visible label when compact but keeps it in the accessible name", () => {
    render(<InFlightList items={ITEMS} density="compact" />);
    expect(screen.queryByText("Engage ascent autopilot")).toBeNull();
    // Not painted, but still in the accessible name with the countdown.
    expect(
      screen.getByRole("listitem", { name: /Engage ascent autopilot/ }),
    ).toBeInTheDocument();
  });

  it("collapses the whole set to a count and the nearest arrival when tiny", () => {
    render(
      <InFlightList items={ITEMS} density="badge" ariaLabel="Warp queue" />,
    );
    // The nearest arrival is what changes what the operator does next.
    expect(
      screen.getByLabelText(/Warp queue: 2 in flight, next in/),
    ).toBeInTheDocument();
    expect(screen.getByText(/^2/)).toBeInTheDocument();
  });

  it("renders nothing when nothing is in flight, at every density", () => {
    const { container } = render(<InFlightList items={[]} density="badge" />);
    expect(container).toBeEmptyDOMElement();
  });
});
