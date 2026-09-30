import {
  type ComponentDefinition,
  type Reading,
  type TinyEssential,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NULL_DISPLAY } from "./NullValue";
import {
  showsTiny,
  smallestBodyTile,
  TinyEssentials,
  WidgetBody,
} from "./TinyEssentials";

const held: Reading<Value<"m">> = {
  state: "held",
  reckoning: { status: "none" },
  value: value("m", 1200),
  asOfUt: value("ut", 100),
  grade: "held",
};

const ESSENTIALS: readonly TinyEssential[] = [
  { label: "Alt", value: value("m", 1200) },
  { label: "V/S", value: value("m/s", -12) },
];

function widget(tiny?: ComponentDefinition["tiny"]): ComponentDefinition {
  return {
    id: "tiny-test",
    name: "Tiny test",
    description: "",
    tags: [],
    component: () => <p>the body</p>,
    tiny,
  };
}

describe("WidgetBody", () => {
  const tiny = {
    title: "TEST",
    useEssentials: () => ESSENTIALS,
  };

  it("draws the kit's tiny form in the tiny bucket and the body above it", () => {
    const { unmount } = render(
      <WidgetBody def={widget(tiny)} id="t" w={4} h={6} />,
    );
    expect(screen.getByText("TEST")).toBeInTheDocument();
    expect(screen.queryByText("the body")).toBeNull();
    unmount();

    render(<WidgetBody def={widget(tiny)} id="t" w={5} h={4} />);
    expect(screen.getByText("the body")).toBeInTheDocument();
  });

  it("draws the body at every size when the widget declares no tiny mode", () => {
    render(<WidgetBody def={widget()} id="t" w={2} h={2} />);
    expect(screen.getByText("the body")).toBeInTheDocument();
  });

  it("draws the body before the grid has measured", () => {
    render(<WidgetBody def={widget(tiny)} id="t" />);
    expect(screen.getByText("the body")).toBeInTheDocument();
  });

  it("switches at the body's own floor where one is declared", () => {
    const floored = { ...tiny, bodyMinSize: { w: 7, h: 9 } };
    expect(showsTiny(floored, 6, 20)).toBe(true);
    expect(showsTiny(floored, 12, 8)).toBe(true);
    expect(showsTiny(floored, 7, 9)).toBe(false);
  });
});

describe("smallestBodyTile", () => {
  it("is the body's floor, or the tiny bucket's edge, never below minSize", () => {
    const tiny = { title: "T", useEssentials: () => [] };
    expect(smallestBodyTile(tiny, { w: 3, h: 3 })).toEqual({ w: 5, h: 4 });
    expect(smallestBodyTile(tiny, { w: 6, h: 2 })).toEqual({ w: 6, h: 4 });
    expect(
      smallestBodyTile(
        { ...tiny, bodyMinSize: { w: 7, h: 9 } },
        { w: 3, h: 4 },
      ),
    ).toEqual({ w: 7, h: 9 });
  });
});

describe("TinyEssentials", () => {
  it("pairs each figure with its label, the first as the hero", async () => {
    const { container } = render(
      <TinyEssentials title="LANDING" essentials={ESSENTIALS} />,
    );
    const terms = [...container.querySelectorAll("dt")].map(
      (d) => d.textContent,
    );
    expect(terms).toEqual(["Alt", "V/S"]);
    expect(container.querySelectorAll("[data-tiny-essential]")).toHaveLength(2);
    await expectNoA11yViolations(container);
  });

  it("wires the D2 tiny header: a focusable group named by its own sr-only heading", () => {
    render(<TinyEssentials title="LANDING" essentials={ESSENTIALS} />);
    const panel = screen.getByRole("group", { name: "LANDING" });
    expect(panel).toHaveAttribute("tabindex", "0");
    const heading = screen.getByRole("heading", { level: 3, name: "LANDING" });
    expect(panel.getAttribute("aria-labelledby")).toBe(heading.id);
  });

  it("keeps a lone figure's caption for the ear only when the heading already names it", () => {
    const { container, unmount } = render(
      <TinyEssentials
        title="TWR"
        essentials={[{ label: "TWR", value: value("1", 1.4) }]}
      />,
    );
    const term = container.querySelector("dt");
    expect(term?.textContent).toBe("TWR");
    expect(getComputedStyle(term as Element).position).toBe("absolute");
    unmount();

    const { container: named } = render(
      <TinyEssentials
        title="CREW"
        essentials={[{ label: "Aboard", value: value("count", 3) }]}
      />,
    );
    expect(
      getComputedStyle(named.querySelector("dt") as Element).position,
    ).not.toBe("absolute");
  });

  it("marks a held reading and draws the null token for a missing one", () => {
    const { container } = render(
      <TinyEssentials
        title="T"
        essentials={[
          { label: "Alt", value: held },
          { label: "V/S", value: null },
        ]}
      />,
    );
    expect(container.querySelectorAll("[data-held]")).toHaveLength(1);
    expect(screen.getByText(NULL_DISPLAY)).toBeInTheDocument();
  });

  it("draws a declared level glyph beside the figure, named by its label", () => {
    render(
      <TinyEssentials
        title="COMMNET"
        essentials={[
          {
            label: "Signal",
            value: value("ratio", 0.62),
            level: { lit: 3, of: 4 },
            tone: "go",
          },
        ]}
      />,
    );
    expect(
      screen.getByRole("img", { name: "Signal 3 of 4" }),
    ).toBeInTheDocument();
  });

  describe("a hero's gauge bar", () => {
    const gauge = {
      min: value("m", 0),
      max: value("m", 2000),
      bands: [
        { from: value("m", 0), to: value("m", 500), tone: "nogo" as const },
      ],
    };
    const fill = (container: HTMLElement) =>
      container.querySelector("[data-tiny-gauge-fill]");

    it("fills to the value's share of the scale, pinned at either end, hidden from the ear", async () => {
      const { container, rerender } = render(
        <TinyEssentials
          title="T"
          essentials={[{ label: "Alt", value: value("m", 1500), gauge }]}
        />,
      );
      expect(container.querySelector("[data-tiny-gauge]")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
      expect(fill(container)).toHaveAttribute("width", "75");
      rerender(
        <TinyEssentials
          title="T"
          essentials={[{ label: "Alt", value: value("m", 9000), gauge }]}
        />,
      );
      expect(fill(container)).toHaveAttribute("width", "100");
      await expectNoA11yViolations(container);
    });

    it("dims its fill once the reading stops arriving, and draws no fill with no value", () => {
      const { container, rerender } = render(
        <TinyEssentials
          title="T"
          essentials={[{ label: "Alt", value: held, gauge }]}
        />,
      );
      expect(container.querySelector("[data-tiny-gauge]")).toHaveAttribute(
        "data-held",
      );
      expect(fill(container)).toHaveAttribute("opacity", "0.55");
      rerender(
        <TinyEssentials
          title="T"
          essentials={[{ label: "Alt", value: null, gauge }]}
        />,
      );
      expect(fill(container)).toBeNull();
      expect(container.querySelector("[data-tiny-gauge] rect")).not.toBeNull();
    });

    it("is drawn by the hero alone", () => {
      const { container } = render(
        <TinyEssentials
          title="T"
          essentials={[
            { label: "Alt", value: value("m", 1500) },
            { label: "Apo", value: value("m", 1500), gauge },
          ]}
        />,
      );
      expect(container.querySelector("[data-tiny-gauge]")).toBeNull();
    });
  });

  describe("in a tile too short for every row", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    /** Each drawn essential is 20px tall, stacked, in a fit box `room` px tall. */
    function stubLayout(room: number) {
      vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
        function (this: HTMLElement) {
          return this.hasAttribute("data-panel-fit-body") ? room : 0;
        },
      );
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
        function (this: Element) {
          const drawn = Array.from(
            document.querySelectorAll("[data-tiny-essential]"),
          );
          const top = Math.max(0, drawn.indexOf(this)) * 20;
          return DOMRect.fromRect({ x: 0, y: top, width: 80, height: 20 });
        },
      );
    }

    const THREE: readonly TinyEssential[] = [
      { label: "Alt", value: value("m", 1200) },
      { label: "V/S", value: value("m/s", -12) },
      { label: "Hdg", value: value("deg", 90) },
    ];

    it("draws the rows that fit, in order, and drops the rest", async () => {
      stubLayout(45);
      const { container } = render(
        <TinyEssentials title="LANDING" essentials={THREE} />,
      );
      expect(
        [...container.querySelectorAll("[data-tiny-essential]")].map(
          (e) => e.querySelector("dt")?.textContent,
        ),
      ).toEqual(["Alt", "V/S"]);
      expect(screen.queryByText("Hdg")).toBeNull();
      await expectNoA11yViolations(container);
    });

    it("draws every row when they all fit", () => {
      stubLayout(60);
      const { container } = render(
        <TinyEssentials title="LANDING" essentials={THREE} />,
      );
      expect(container.querySelectorAll("[data-tiny-essential]")).toHaveLength(
        3,
      );
    });

    it("still says the word of a row it had no room to draw", () => {
      stubLayout(25);
      const { container } = render(
        <TinyEssentials
          title="KSC"
          essentials={[
            { label: "Funds", value: value("funds", 1200) },
            { label: "Pad", word: "ACTIVE", tone: "go" },
          ]}
        />,
      );
      expect(screen.queryByText("ACTIVE")).toBeNull();
      const spoken = [...container.querySelectorAll("[aria-live]")]
        .map((r) => r.textContent)
        .filter((t) => t !== "");
      expect(spoken).toEqual(["Pad ACTIVE"]);
    });
  });

  it("draws a state word in the figure's place, in its tone, beside any level glyph", async () => {
    const { container } = render(
      <TinyEssentials
        title="COMMNET"
        essentials={[
          {
            label: "Signal",
            word: "LOS",
            value: value("ratio", 0.62),
            level: { lit: 0, of: 4 },
            tone: "nogo",
          },
        ]}
      />,
    );
    const figure = container.querySelector("dd") as HTMLElement;
    expect(figure.textContent).toContain("LOS");
    expect(figure.textContent).not.toContain("62");
    expect(figure.querySelector("[data-level-bars]")).not.toBeNull();
    expect(getComputedStyle(figure).color).toBe("var(--color-nogo-text)");
    await expectNoA11yViolations(container);
  });

  it("says each state word through one polite region that is there before any word is", () => {
    const essentials = (pad?: string): readonly TinyEssential[] => [
      { label: "Funds", value: value("funds", 1200) },
      { label: "Pad", word: pad, value: null },
    ];
    const { container, rerender } = render(
      <TinyEssentials title="KSC" essentials={essentials()} />,
    );
    const before = [...container.querySelectorAll("[aria-live]")];
    expect(before.every((r) => r.textContent === "")).toBe(true);

    rerender(<TinyEssentials title="KSC" essentials={essentials("ACTIVE")} />);
    const after = [...container.querySelectorAll("[aria-live]")];
    expect(after).toEqual(before);
    const speaking = after.filter((r) => r.textContent !== "");
    expect(speaking.map((r) => r.textContent)).toEqual(["Pad ACTIVE"]);
    expect(speaking[0]?.getAttribute("aria-live")).toBe("polite");
  });
});

describe("an urgent state word", () => {
  const thermal = (
    word: string | undefined,
    urgent: boolean,
    engine = "COOL",
  ): readonly TinyEssential[] => [
    { label: "Thermal", word, urgent, tone: urgent ? "nogo" : "warn" },
    { label: "Engine", word: engine },
  ];

  function regions(container: HTMLElement) {
    const polite = container.querySelector("[aria-live=polite]");
    const assertive = container.querySelector("[aria-live=assertive]");
    if (polite === null || assertive === null) {
      throw new Error("the tile is missing a live region");
    }
    return { polite, assertive };
  }

  /** Every node added under the region from here on, as the screen reader would be told of it. */
  function watchAdditions(region: Element): () => string[] {
    const added: string[] = [];
    const read = (records: MutationRecord[]) => {
      for (const record of records) {
        for (const node of Array.from(record.addedNodes)) {
          added.push(node.textContent ?? "");
        }
        if (record.type === "characterData") {
          added.push(record.target.textContent ?? "");
        }
      }
    };
    const observer = new MutationObserver(read);
    observer.observe(region, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      read(observer.takeRecords());
      observer.disconnect();
      return added;
    };
  }

  it("is mounted empty and assertive before the word turns urgent, beside the polite region", async () => {
    const { container } = render(
      <TinyEssentials title="THERMAL" essentials={thermal("HOT", false)} />,
    );
    const { polite, assertive } = regions(container);
    expect(assertive.textContent).toBe("");
    expect(polite.textContent).toBe("Thermal HOT, Engine COOL");
    await expectNoA11yViolations(container);
  });

  it("is said through the assertive region and nowhere politely, while ordinary words stay polite", async () => {
    const { container, rerender } = render(
      <TinyEssentials title="THERMAL" essentials={thermal("HOT", false)} />,
    );
    const { polite, assertive } = regions(container);
    rerender(
      <TinyEssentials title="THERMAL" essentials={thermal("CRITICAL", true)} />,
    );
    expect(assertive.textContent).toBe("Thermal CRITICAL. ");
    expect(polite.textContent).toBe("Engine COOL");
    expect(regions(container)).toEqual({ polite, assertive });
    await expectNoA11yViolations(container);
  });

  it("is not said again while it stays urgent and unchanged, whatever else the tile says", () => {
    const { container, rerender } = render(
      <TinyEssentials title="THERMAL" essentials={thermal("CRITICAL", true)} />,
    );
    const { assertive } = regions(container);
    const additions = watchAdditions(assertive);

    rerender(
      <TinyEssentials title="THERMAL" essentials={thermal("CRITICAL", true)} />,
    );
    rerender(
      <TinyEssentials
        title="THERMAL"
        essentials={thermal("CRITICAL", true, "WARM")}
      />,
    );
    expect(additions()).toEqual([]);
    expect(assertive.textContent).toBe("Thermal CRITICAL. ");
  });

  it("is said once more when it changes while urgent, or turns urgent again", () => {
    const { container, rerender } = render(
      <TinyEssentials title="THERMAL" essentials={thermal("CRITICAL", true)} />,
    );
    const { assertive } = regions(container);
    const additions = watchAdditions(assertive);

    rerender(
      <TinyEssentials title="THERMAL" essentials={thermal("MELTING", true)} />,
    );
    rerender(
      <TinyEssentials title="THERMAL" essentials={thermal("HOT", false)} />,
    );
    rerender(
      <TinyEssentials title="THERMAL" essentials={thermal("CRITICAL", true)} />,
    );
    expect(additions()).toEqual(["Thermal MELTING. ", "Thermal CRITICAL. "]);
  });

  it("has no assertive region on a tile where no essential declares one", () => {
    const { container } = render(
      <TinyEssentials
        title="COMMNET"
        essentials={[{ label: "Signal", word: "LOS", tone: "nogo" }]}
      />,
    );
    expect(container.querySelector("[aria-live=assertive]")).toBeNull();
  });
});
