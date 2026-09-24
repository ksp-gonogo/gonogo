import { act, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import {
  expectNoA11yViolations,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { renderOrbitStream } from "../test/orbitScenario";
import { CurrentOrbitComponent } from "./index";

const CAPTION = "Described from last known orbit, not current";

function renderLive() {
  const result = renderOrbitStream(
    <CurrentOrbitComponent id="orbit-caption" w={9} h={18} />,
    { bodyName: "Kerbin", sma: 681_500, ecc: 0.003, argPe: 12 },
    "orbit-caption",
  );
  return result;
}

/**
 * The caption is the whole of what a held orbit adds to this widget: the rows
 * it blanks stay blank and the elements it keeps stay at the same figures.
 */
describe("CurrentOrbit: a held orbit is captioned as not current", () => {
  it("says nothing while the orbit is current", async () => {
    const { container } = renderLive();
    await waitFor(() => expect(visibleText(container)).toContain("Ecc0.0030"));
    expect(visibleText(container)).not.toContain(CAPTION);
  });

  it("captions a held orbit and leaves every figure as it was", async () => {
    const { container, fixture } = renderLive();
    await waitFor(() => expect(visibleText(container)).toContain("Ecc0.0030"));

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });

    await waitFor(() =>
      expect(fixture.store.sampleReading("vessel.orbit").state).toBe("stale"),
    );
    await waitFor(() => expect(visibleText(container)).toContain(CAPTION));

    const text = visibleText(container);
    expect(text).toContain("Inc0.0°");
    expect(text).toContain("Ecc0.0030");
    for (const row of ["Ap", "Pe", "t-Ap", "t-Pe", "T"]) {
      expect(text, `${row} row`).toContain(`${row}${NULL_DISPLAY}`);
    }
    // Plain text, not an announcement: currency flips with the link.
    const caption = [...container.querySelectorAll("span")].find(
      (el) => el.textContent === CAPTION,
    );
    expect(
      caption?.closest("[aria-live], [role='status'], [role='alert']"),
    ).toBeNull();

    await expectNoA11yViolations(container);
  });
});
