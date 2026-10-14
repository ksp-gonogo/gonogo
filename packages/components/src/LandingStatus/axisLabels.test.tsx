import { render } from "@ksp-gonogo/test-utils";
import { LineChart } from "@ksp-gonogo/ui";
import { describe, expect, it } from "vitest";
import { unitTick } from "../Graph/ticks";

/**
 * The descent envelope's axes across the ranges a descent zooms them through, at the plot sizes the widget draws: no two labels on an axis may read the same, nor any read wrong.
 */
const SIDES = [127, 140, 274];

describe("the descent envelope's axes", () => {
  it("never write two ticks the same, at any height span from 50 m to 30 km and any speed span from 5 to 600 m/s", () => {
    const repeats: string[] = [];
    for (const side of SIDES) {
      for (let top = 50; top <= 30_000; top *= 1.15) {
        const right = 5 + (top / 30_000) * 595;
        const { container, unmount } = render(
          <LineChart
            series={[]}
            xDomain={[0, right]}
            yDomainPrimary={[0, top]}
            xTickFormat={(v, _d, ticks) => unitTick("m/s", v, ticks)}
            yTickFormat={(v, ticks) => unitTick("m", v, ticks)}
            width={side}
            height={side}
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
      }
    }
    expect(repeats).toEqual([]);
  });
});
