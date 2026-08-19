import { afterEach, describe, expect, it } from "vitest";
import {
  clearBodies,
  getAllBodies,
  getBody,
  getImagingWindow,
  imagingQuality,
  registerBody,
} from "./bodies";
import { registerStockBodies } from "./stock-bodies";

afterEach(() => clearBodies());

describe("body registry", () => {
  it("returns undefined for an unregistered body", () => {
    expect(getBody("Kerbin")).toBeUndefined();
  });

  it("stores and retrieves a registered body by id", () => {
    registerBody({
      id: "Kerbin",
      name: "Kerbin",
      radius: 600000,
      color: "#1A6B8A",
      hasAtmosphere: false,
      maxAtmosphere: 0,
    });
    const body = getBody("Kerbin");
    expect(body?.name).toBe("Kerbin");
    expect(body?.radius).toBe(600_000);
  });

  it("getAllBodies returns all registered bodies", () => {
    registerBody({
      id: "Kerbin",
      name: "Kerbin",
      radius: 600000,
      hasAtmosphere: false,
      maxAtmosphere: 0,
    });
    registerBody({
      id: "Mun",
      name: "Mun",
      radius: 200000,
      parent: "Kerbin",
      hasAtmosphere: false,
      maxAtmosphere: 0,
    });
    const all = getAllBodies();
    expect(all).toHaveLength(2);
    expect(all.map((b) => b.id)).toContain("Kerbin");
    expect(all.map((b) => b.id)).toContain("Mun");
  });

  it("allows overwriting a body by re-registering with the same id", () => {
    registerBody({
      id: "Kerbin",
      name: "Kerbin",
      radius: 600000,
      hasAtmosphere: false,
      maxAtmosphere: 0,
    });
    registerBody({
      id: "Kerbin",
      name: "Kerbin (modded)",
      radius: 650000,
      hasAtmosphere: false,
      maxAtmosphere: 0,
    });
    expect(getBody("Kerbin")?.radius).toBe(650_000);
    expect(getAllBodies()).toHaveLength(1);
  });

  it("clearBodies empties the registry", () => {
    registerBody({
      id: "Kerbin",
      name: "Kerbin",
      radius: 600000,
      hasAtmosphere: false,
      maxAtmosphere: 0,
    });
    clearBodies();
    expect(getAllBodies()).toHaveLength(0);
  });
});

describe("registerStockBodies", () => {
  it("registers all 17 Kerbol system bodies", () => {
    registerStockBodies();
    expect(getAllBodies()).toHaveLength(17);
  });

  it("registers Kerbin with correct radius", () => {
    registerStockBodies();
    expect(getBody("Kerbin")?.radius).toBe(600_000);
  });

  it("registers Mun as a child of Kerbin", () => {
    registerStockBodies();
    expect(getBody("Mun")?.parent).toBe("Kerbin");
  });

  it("registers the star as Sun", () => {
    registerStockBodies();
    const star = getBody("Sun");
    expect(star?.name).toBe("Kerbol");
    expect(star?.radius).toBe(261_600_000);
  });

  it("all bodies with a parent reference a body that is also registered", () => {
    registerStockBodies();
    const all = getAllBodies();
    const ids = new Set(all.map((b) => b.id));
    for (const body of all) {
      if (body.parent) {
        expect(
          ids.has(body.parent),
          `${body.id}.parent "${body.parent}" not registered`,
        ).toBe(true);
      }
    }
  });
});

describe("imaging window", () => {
  it("uses explicit values when provided", () => {
    const body = {
      id: "X",
      name: "X",
      radius: 600_000,
      hasAtmosphere: false,
      maxAtmosphere: 0,
      imagingMinAlt: 10,
      imagingIdealAlt: 20,
      imagingMaxAlt: 30,
      cameraFovDeg: 45,
    };
    expect(getImagingWindow(body)).toEqual({
      min: 10,
      ideal: 20,
      max: 30,
      fovDeg: 45,
    });
  });

  it("floors the min above the atmosphere for atmospheric bodies", () => {
    const body = {
      id: "X",
      name: "X",
      radius: 600_000,
      hasAtmosphere: true,
      maxAtmosphere: 70_000,
    };
    const { min } = getImagingWindow(body);
    expect(min).toBeGreaterThanOrEqual(70_000 + 10_000);
  });

  it("uses a fraction of radius as min for airless bodies", () => {
    const body = {
      id: "X",
      name: "X",
      radius: 200_000,
      hasAtmosphere: false,
      maxAtmosphere: 0,
    };
    const { min } = getImagingWindow(body);
    expect(min).toBeCloseTo(200_000 * 0.05);
  });

  it("defaults fovDeg to 30", () => {
    const body = {
      id: "X",
      name: "X",
      radius: 1,
      hasAtmosphere: false,
      maxAtmosphere: 0,
    };
    expect(getImagingWindow(body).fovDeg).toBe(30);
  });
});

describe("imagingQuality", () => {
  const body = {
    id: "Kerbin",
    name: "Kerbin",
    radius: 600_000,
    hasAtmosphere: true,
    maxAtmosphere: 70_000,
    imagingMinAlt: 80_000,
    imagingIdealAlt: 125_000,
    imagingMaxAlt: 500_000,
  };

  it("returns 0 below min", () => {
    expect(imagingQuality(50_000, body)).toBe(0);
    expect(imagingQuality(80_000, body)).toBe(0);
  });

  it("returns 0 above max", () => {
    expect(imagingQuality(500_000, body)).toBe(0);
    expect(imagingQuality(750_000, body)).toBe(0);
  });

  it("ramps from 0 to 1 between min and ideal", () => {
    const mid = (80_000 + 125_000) / 2;
    expect(imagingQuality(mid, body)).toBeCloseTo(0.5, 5);
  });

  it("holds 1 between ideal and midway to max", () => {
    const holdEnd = (125_000 + 500_000) / 2;
    expect(imagingQuality(125_000, body)).toBe(1);
    expect(imagingQuality(holdEnd, body)).toBe(1);
  });

  it("ramps back to 0 past the hold end", () => {
    const holdEnd = (125_000 + 500_000) / 2;
    const between = (holdEnd + 500_000) / 2;
    expect(imagingQuality(between, body)).toBeCloseTo(0.5, 5);
  });
});
