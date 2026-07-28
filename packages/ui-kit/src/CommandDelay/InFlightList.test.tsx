import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { InFlightList, type InFlightListItem } from "./InFlightList";

const ITEMS: InFlightListItem[] = [
  { id: "1", label: "run boot.ks", etaSeconds: 4, phase: "in-transit" },
  { id: "2", label: "run land.ks", etaSeconds: 12, phase: "awaiting-reply" },
  { id: "3", label: "run abort.ks", etaSeconds: null, phase: "lost" },
];

describe("InFlightList", () => {
  it("renders nothing for an empty set", () => {
    const { container } = render(<InFlightList items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one row per item, with an accessible label and a countdown", () => {
    render(<InFlightList items={ITEMS} />);
    const list = screen.getByLabelText("In-flight commands");
    expect(list).toHaveTextContent("run boot.ks");
    expect(list).toHaveTextContent("run land.ks");
    expect(list).toHaveTextContent("run abort.ks");
    // in-transit: a countdown formatted from etaSeconds.
    expect(list).toHaveTextContent("4s");
  });

  it("shows the bare phase word when etaSeconds is null (no ETA to count)", () => {
    render(<InFlightList items={ITEMS} />);
    expect(screen.getByLabelText("In-flight commands")).toHaveTextContent(
      "lost",
    );
  });

  it("accepts a custom aria-label", () => {
    render(<InFlightList items={ITEMS} ariaLabel="Uplink queue" />);
    expect(screen.getByLabelText("Uplink queue")).toBeTruthy();
  });

  it("has no axe violations across phases, incl. the error tones", async () => {
    const { container } = render(<InFlightList items={ITEMS} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
