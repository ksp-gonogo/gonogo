/**
 * Stock Kerbol system body definitions.
 *
 * Call registerStockBodies() once at app startup to populate the registry
 * with all stock KSP celestial bodies. The IDs match the strings Telemachus
 * returns for v.body / o.referenceBody so that getBody(v.body) works directly.
 *
 * Radii sourced from the KSP wiki (accurate to stock KSP 1.x).
 * External packages (mods, planet packs) can call registerBody() afterward
 * to add or override entries.
 */

import { registerBody } from "./bodies";

/**
 * Base URL for body texture images. Textures are served from the app's
 * public/bodies/ directory. Pass import.meta.env.BASE_URL from the app
 * entrypoint to handle sub-path deployments (e.g. /gonogo/bodies/).
 */
export function registerStockBodies(baseUrl = "bodies"): void {
  const tex = (name: string) => `${baseUrl}/${name}_Color.png`;

  // ── Star ─────────────────────────────────────────────────────────────────
  registerBody({
    id: "Sun",
    name: "Kerbol",
    radius: 261600000,
    gm: 1.1723328e18,
    color: "#FFF44F",
    hasAtmosphere: true,
    maxAtmosphere: 600000,
    rotationPeriod: 432000,
  });

  // ── Inner planets ────────────────────────────────────────────────────────
  registerBody({
    id: "Moho",
    name: "Moho",
    radius: 250000,
    gm: 1.6860938e11,
    color: "#8B7355",
    parent: "Sun",
    hasAtmosphere: false,
    maxAtmosphere: 0,
    rotationPeriod: 1210000,
  });

  registerBody({
    id: "Eve",
    name: "Eve",
    radius: 700000,
    gm: 8.1717302e12,
    color: "#9B59B6",
    parent: "Sun",
    texture: tex("Eve"),
    hasAtmosphere: true,
    maxAtmosphere: 90000,
    // 5 atm at sea level, very thick.
    atmosphere: { surfacePressure: 506_625, scaleHeight: 7_000 },
    rotationPeriod: 80500,
  });

  registerBody({
    id: "Gilly",
    name: "Gilly",
    radius: 13000,
    gm: 8289449.8,
    color: "#A0855B",
    parent: "Eve",
    texture: tex("Gilly"),
    hasAtmosphere: false,
    maxAtmosphere: 0,
    rotationPeriod: 28255,
  });

  registerBody({
    id: "Kerbin",
    name: "Kerbin",
    radius: 600000,
    gm: 3.5316e12,
    color: "#1A6B8A",
    parent: "Sun",
    texture: tex("Kerbin"),
    // Texture prime meridian is offset 90° east of KSP/Telemachus coordinates.
    // Tune this value if the vessel dot appears misaligned on the map.
    longitudeOffset: 90,
    hasAtmosphere: true,
    maxAtmosphere: 70000,
    // 1 atm at sea level, ~Earth-like.
    atmosphere: { surfacePressure: 101_325, scaleHeight: 5_600 },
    rotationPeriod: 21549.425,
    // Sweet spot modelled on real low-Earth-orbit imaging scaled for Kerbin:
    // below the atmosphere gives no useful data, deep space gives too little
    // resolution. 125 km sits in the usual low-orbit band.
    imagingMinAlt: 80_000,
    imagingIdealAlt: 125_000,
    imagingMaxAlt: 500_000,
    // KSC sits at roughly (-0.10°, -74.56°) in Telemachus's raw frame. Seed
    // a generous region so launch / landing at the space centre starts with
    // visible map context.
    initialReveal: {
      lat: -0.0972,
      lon: -74.5577,
      radiusMetres: 60_000,
    },
  });

  registerBody({
    id: "Mun",
    name: "Mun",
    radius: 200000,
    gm: 6.5138398e10,
    color: "#888888",
    parent: "Kerbin",
    texture: tex("Mun"),
    hasAtmosphere: false,
    maxAtmosphere: 0,
    rotationPeriod: 138984.38,
  });

  registerBody({
    id: "Minmus",
    name: "Minmus",
    radius: 60000,
    gm: 1.7658e9,
    color: "#B8D4B8",
    parent: "Kerbin",
    texture: tex("Minmus"),
    hasAtmosphere: false,
    maxAtmosphere: 0,
    rotationPeriod: 40400,
  });

  registerBody({
    id: "Duna",
    name: "Duna",
    radius: 320000,
    gm: 3.0136321e11,
    color: "#C1440E",
    parent: "Sun",
    texture: tex("Duna"),
    hasAtmosphere: true,
    maxAtmosphere: 50000,
    // ~0.067 atm at sea level — too thin for jet engines, just enough for chutes.
    atmosphere: { surfacePressure: 6_755, scaleHeight: 2_700 },
    rotationPeriod: 65517.859,
  });

  registerBody({
    id: "Ike",
    name: "Ike",
    radius: 130000,
    gm: 1.8568369e10,
    color: "#9B9B8B",
    parent: "Duna",
    texture: tex("Ike"),
    hasAtmosphere: false,
    maxAtmosphere: 0,
    rotationPeriod: 65517.862,
  });

  registerBody({
    id: "Dres",
    name: "Dres",
    radius: 138000,
    gm: 2.1484489e10,
    color: "#7A7A6A",
    parent: "Sun",
    texture: tex("Dres"),
    hasAtmosphere: false,
    maxAtmosphere: 0,
    rotationPeriod: 34800,
  });

  // ── Outer system ─────────────────────────────────────────────────────────
  registerBody({
    id: "Jool",
    name: "Jool",
    radius: 6000000,
    gm: 2.82528e14,
    color: "#4A7C3F",
    parent: "Sun",
    hasAtmosphere: true,
    maxAtmosphere: 200000,
    // ~15 atm at "sea level" (datum), gas giant — there's no surface to land on.
    atmosphere: { surfacePressure: 1_519_875, scaleHeight: 20_000 },
    rotationPeriod: 36000,
  });

  registerBody({
    id: "Laythe",
    name: "Laythe",
    radius: 500000,
    gm: 1.962e12,
    color: "#1E6091",
    parent: "Jool",
    texture: tex("Laythe"),
    hasAtmosphere: true,
    maxAtmosphere: 50000,
    // ~0.6 atm at sea level — breathable-ish on Jool's tropical moon.
    atmosphere: { surfacePressure: 60_795, scaleHeight: 4_000 },
    rotationPeriod: 52980.879,
  });

  registerBody({
    id: "Vall",
    name: "Vall",
    radius: 300000,
    gm: 2.074815e11,
    color: "#B0C4D8",
    parent: "Jool",
    texture: tex("Vall"),
    hasAtmosphere: false,
    maxAtmosphere: 0,
    rotationPeriod: 105962.09,
  });

  registerBody({
    id: "Tylo",
    name: "Tylo",
    radius: 600000,
    gm: 2.82528e12,
    color: "#A0A080",
    parent: "Jool",
    texture: tex("Tylo"),
    hasAtmosphere: false,
    maxAtmosphere: 0,
    rotationPeriod: 211926.36,
  });

  registerBody({
    id: "Bop",
    name: "Bop",
    radius: 65000,
    gm: 2.4868349e9,
    color: "#6B5B45",
    parent: "Jool",
    texture: tex("Bop"),
    hasAtmosphere: false,
    maxAtmosphere: 0,
    rotationPeriod: 544507.43,
  });

  registerBody({
    id: "Pol",
    name: "Pol",
    radius: 44000,
    gm: 7.2170208e8,
    color: "#D4C878",
    parent: "Jool",
    texture: tex("Pol"),
    hasAtmosphere: false,
    maxAtmosphere: 0,
    rotationPeriod: 901902.62,
  });

  registerBody({
    id: "Eeloo",
    name: "Eeloo",
    radius: 210000,
    gm: 7.4410815e10,
    color: "#E8E8F0",
    parent: "Sun",
    texture: tex("Eeloo"),
    hasAtmosphere: false,
    maxAtmosphere: 0,
    rotationPeriod: 19460,
  });
}
