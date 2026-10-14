import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { installFixedSizeResizeObserver } from "../testing";
import { Graph } from "./Graph";

/**
 * A graph's unit-labelled axes across the ranges a descent zooms them through, at the plot sizes the widget draws: no two labels on an axis may read the same, nor any read wrong.
 */
const SIDES = [127, 140, 274];

describe("a graph's unit-labelled axes", () => {
  it("never write two ticks the same, at any height span from 50 m to 30 km and any speed span from 5 to 600 m/s", () => {
    const repeats: string[] = [];
    for (const side of SIDES) {
      for (let top = 50; top <= 30_000; top *= 1.15) {
        const right = 5 + (top / 30_000) * 595;
        const uninstall = installFixedSizeResizeObserver({
          width: side,
          height: side,
        });
        const { container, unmount } = render(
          <Graph
            chrome="bare"
            series={[]}
            xKind="value"
            crosshair={false}
            xDomain={[0, right]}
            yDomainPrimary={[0, top]}
            xUnit="m/s"
            yUnit="m"
          />,
        );
        const y = [
          ...container.querySelectorAll(
            'text[text-anchor="end"][dominant-baseline="middle"]',
          ),
        ].map((t) => t.textContent ?? "");
        const x = [...container.querySelectorAll("text")]
          .filter((t) => !t.hasAttribute("dominant-baseline"))
          .map((t) => t.textContent ?? "");
        for (const [axis, labels] of [
          ["y", y],
          ["x", x],
        ] as const) {
          if (new Set(labels).size !== labels.length) {
            repeats.push(
              `${axis} at ${side}px, ${top.toFixed(0)} m: ${labels.join(", ")}`,
            );
          }
        }
        unmount();
        uninstall();
      }
    }
    expect(repeats).toEqual([]);
  });
});
