import { act, waitFor } from "@ksp-gonogo/test-utils";
import {
  expectNoA11yViolations,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { renderOrbitViewStream } from "./streamHarness";

const CAPTION = "Described from last known orbit, not current";

/**
 * A held orbit keeps drawing, and the caption is the only thing it adds: the
 * diagram's markers are the same ones the live orbit drew.
 */
describe("OrbitView: a held orbit is captioned as not current", () => {
  for (const size of [
    { w: 9, h: 18, name: "portrait" },
    { w: 12, h: 4, name: "landscape" },
  ]) {
    it(`captions a held orbit and keeps the diagram (${size.name})`, async () => {
      const { container, fixture } = renderOrbitViewStream(
        { w: size.w, h: size.h },
        { bodyName: "Kerbin", sma: 681_500, ecc: 0.003, argPe: 12 },
      );
      await waitFor(() =>
        expect(container.querySelectorAll("svg circle").length).toBeGreaterThan(
          0,
        ),
      );
      expect(visibleText(container)).not.toContain(CAPTION);
      const liveMarkers = container.querySelectorAll("svg circle").length;

      act(() => {
        fixture.store.setTransportConnected(false);
        fixture.store.beginFrame();
      });

      await waitFor(() =>
        expect(fixture.store.sampleReading("vessel.orbit").state).toBe("stale"),
      );
      await waitFor(() => expect(visibleText(container)).toContain(CAPTION));
      expect(container.querySelectorAll("svg circle").length).toBe(liveMarkers);

      const caption = [...container.querySelectorAll("span")].find(
        (el) => el.textContent === CAPTION,
      );
      expect(
        caption?.closest("[aria-live], [role='status'], [role='alert']"),
      ).toBeNull();

      await expectNoA11yViolations(container);
    });
  }
});
