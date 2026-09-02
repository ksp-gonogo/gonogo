import { screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { renderOrbitViewStream } from "./streamHarness";

/**
 * Two defects a live render surfaced at the smallest widget sizes:
 *
 * - the panel title truncated to "O..." (2 of 10 characters) despite room in the
 *   header row for far more; a short size-gated title uses that room instead.
 * - the "orbit plane" frame caption rendered alongside the tiny-mode status
 *   pill, captioning a diagram that at that size does not exist. Both were
 *   visible at once, which is what made the caption read as noise: it
 *   answered a question ("which frame is the drawing in") for a drawing that
 *   was not on screen.
 */
const SCENARIO = { bodyName: "Kerbin", sma: 681500, ecc: 0.003, argPe: 12 };

async function waitForSettled(container: HTMLElement) {
  await waitFor(() => {
    if (visibleText(container).includes("No orbital data")) {
      throw new Error("orbit has not settled yet");
    }
  });
}

describe("OrbitView: title and frame caption at the tiny-mode threshold", () => {
  it("shortens the title below the diagram threshold instead of ellipsis-truncating the full one", async () => {
    const { container } = renderOrbitViewStream({ w: 3, h: 3 }, SCENARIO);
    await waitForSettled(container);

    // The pill fallback state itself: proves the widget actually settled
    // into tiny mode, not some other empty/loading render.
    expect(screen.getByText("ORBIT")).toBeInTheDocument();

    const heading = screen.getByRole("heading", { level: 3 });
    expect(heading).toHaveTextContent("OVIEW");
    expect(heading).not.toHaveTextContent("ORBIT VIEW");
  });

  it("drops the frame caption below the diagram threshold: there's no drawing left for it to caption", async () => {
    const { container } = renderOrbitViewStream({ w: 3, h: 3 }, SCENARIO);
    await waitForSettled(container);

    expect(screen.getByText("ORBIT")).toBeInTheDocument();
    expect(screen.queryByText(/orbit plane/i)).not.toBeInTheDocument();
  });

  it("keeps the full title and the frame caption once the diagram has room", async () => {
    const { container } = renderOrbitViewStream({ w: 9, h: 18 }, SCENARIO);
    await waitForSettled(container);

    const heading = screen.getByRole("heading", { level: 3 });
    expect(heading).toHaveTextContent("ORBIT VIEW");

    expect(await screen.findByText(/orbit plane/i)).toBeInTheDocument();
  });
});
