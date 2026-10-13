import { describe, expect, it } from "vitest";
import {
  emitScenario,
  type OrbitScenario,
  renderOrbitStream,
} from "../test/orbitScenario";
import { useIsOrbiting } from "./useIsOrbiting";

/** Orbiting turns on the atmosphere's height, so it has three answers: yes, no, and not yet known. */
function Probe() {
  const { isOrbiting } = useIsOrbiting();
  return <span data-testid="verdict">{String(isOrbiting)}</span>;
}

const KERBIN: OrbitScenario = {
  bodyName: "Kerbin",
  sma: 681500,
  ecc: 0.005,
};

function verdict(container: HTMLElement): string | undefined {
  return container.querySelector('[data-testid="verdict"]')?.textContent ?? "";
}

describe("useIsOrbiting", () => {
  it("is undetermined, not sub-orbital, while the parent body has not arrived", () => {
    const { container } = renderOrbitStream(<Probe />, {
      sma: 681500,
      ecc: 0.005,
    });
    expect(verdict(container)).toBe("null");
  });

  it("answers once the body has", () => {
    const { container, fixture } = renderOrbitStream(<Probe />, {
      sma: 681500,
      ecc: 0.005,
    });
    emitScenario(fixture, KERBIN);
    expect(verdict(container)).toBe("true");
  });

  it("keeps a known answer of no where the periapsis is inside the atmosphere", () => {
    const { container } = renderOrbitStream(<Probe />, {
      ...KERBIN,
      sma: 640000,
    });
    expect(verdict(container)).toBe("false");
  });
});
