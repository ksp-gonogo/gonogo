import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
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

  describe('variant="rail" (v3 glow band)', () => {
    it("renders an svg strip with one glow per item, not the monospace list", () => {
      const { container } = render(
        <InFlightList items={ITEMS} variant="rail" />,
      );
      // The strip is an <svg role="img">, no monospace row list.
      const svg = container.querySelector("svg");
      expect(svg).not.toBeNull();
      expect(svg).toHaveAttribute("role", "img");
      expect(container.querySelectorAll('[data-role="glow"]')).toHaveLength(
        ITEMS.length,
      );
      // No monospace list root in the rail rendering.
      expect(container.textContent).not.toContain("run boot.ks");
    });

    it("draws no axis dividers or baseline (a grazing glow, not markers on a line)", () => {
      const { container } = render(
        <InFlightList items={ITEMS} variant="rail" />,
      );
      expect(container.querySelectorAll("[data-divider]")).toHaveLength(0);
      expect(container.querySelector('[data-role="baseline"]')).toBeNull();
    });

    it("centres each glow ABOVE the top edge and positions its x by journey progress", () => {
      const items: InFlightListItem[] = [
        {
          id: "early",
          label: "a",
          etaSeconds: 5,
          phase: "in-transit",
          progress: 0.1,
        },
        {
          id: "late",
          label: "b",
          etaSeconds: 2,
          phase: "awaiting-reply",
          progress: 0.8,
        },
      ];
      const { container } = render(
        <InFlightList items={items} variant="rail" />,
      );
      const grads = Array.from(container.querySelectorAll("radialGradient"));
      expect(grads).toHaveLength(2);
      const cxs = grads.map((g) => Number(g.getAttribute("cx")));
      // The lower-progress command sits left of the higher-progress one.
      expect(cxs[0]).toBeLessThan(cxs[1]);
      // Every glow centres above the strip (cy < 0), so only the blur grazes
      // the top edge and the disc itself is never visible.
      for (const g of grads) {
        expect(Number(g.getAttribute("cy"))).toBeLessThan(0);
      }
    });

    it("carries an in-flight count in its accessible name", () => {
      render(<InFlightList items={ITEMS} variant="rail" />);
      expect(
        screen.getByRole("img", { name: /3 in flight/ }),
      ).toBeInTheDocument();
    });

    it("renders nothing for an empty set", () => {
      const { container } = render(<InFlightList items={[]} variant="rail" />);
      expect(container).toBeEmptyDOMElement();
    });

    it("has no axe violations", async () => {
      const { container } = render(
        <InFlightList items={ITEMS} variant="rail" />,
      );
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  describe('variant="expanded" (compact-mode command queue)', () => {
    it("renders one square per command, each showing the command's own glyph", () => {
      const { container } = render(
        <InFlightList
          items={[
            {
              id: "1",
              label: "SAS Prograde",
              etaSeconds: 4,
              phase: "in-transit",
              glyph: "PRO",
            },
            {
              id: "2",
              label: "SAS Retrograde",
              etaSeconds: 8,
              phase: "awaiting-reply",
              glyph: "RET",
            },
          ]}
          variant="expanded"
        />,
      );
      const list = container.querySelector('[role="list"]');
      expect(list).toHaveAttribute("aria-label", "In-flight commands");
      const cmds = container.querySelectorAll('[role="listitem"][data-phase]');
      expect(cmds).toHaveLength(2);
      // The command's OWN glyph, not a status icon.
      expect(container.textContent).toContain("PRO");
      expect(container.textContent).toContain("RET");
      // Each command (a listitem) is named by the full label.
      expect(cmds[0].getAttribute("aria-label")).toContain("SAS Prograde");
    });

    it("falls back to a label abbreviation when a command carries no glyph", () => {
      const { container } = render(
        <InFlightList
          items={[
            {
              id: "1",
              label: "Set target",
              etaSeconds: 4,
              phase: "in-transit",
            },
          ]}
          variant="expanded"
        />,
      );
      // deriveGlyph("Set target") -> "TARG".
      expect(container.textContent).toContain("TARG");
    });

    it("makes an overdue/lost square a real clear button wired to onDismiss", async () => {
      const dismissed: string[] = [];
      const { container } = render(
        <InFlightList
          items={[
            {
              id: "dead",
              label: "SAS Prograde",
              etaSeconds: null,
              phase: "lost",
              glyph: "PRO",
            },
          ]}
          variant="expanded"
          onDismiss={(id) => dismissed.push(id)}
        />,
      );
      const btn = container.querySelector("button");
      expect(btn).not.toBeNull();
      expect(btn?.getAttribute("aria-label")).toContain("Dismiss");
      btn?.click();
      expect(dismissed).toEqual(["dead"]);
    });

    it("renders nothing for an empty set", () => {
      const { container } = render(
        <InFlightList items={[]} variant="expanded" />,
      );
      expect(container).toBeEmptyDOMElement();
    });

    it("has no axe violations (incl. a lost clear button)", async () => {
      const { container } = render(
        <InFlightList
          items={[
            {
              id: "1",
              label: "SAS Prograde",
              etaSeconds: 4,
              phase: "in-transit",
              glyph: "PRO",
            },
            {
              id: "2",
              label: "SAS Retrograde",
              etaSeconds: null,
              phase: "lost",
              glyph: "RET",
            },
          ]}
          variant="expanded"
          onDismiss={() => {}}
        />,
      );
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
