/**
 * RealSolarSystem (RSS) body definitions.
 *
 * RSS is core to the RO/RP-1 stack: it replaces the stock Kerbol system with
 * the real solar system (real bodies, radii, SOI, atmospheres). Call
 * registerRSSBodies() ONLY when RSS is present, it deliberately reuses stock
 * body ids ("Sun", "Earth", "Moon", …), and "Sun" collides with the stock
 * Kerbol entry, so registering these on a stock save would clobber it. This is
 * a presence-gated entrypoint, the mirror of registerStockBodies().
 *
 * RSS defines its bodies through Kopernicus with `cbNameLater`, which renames
 * each CelestialBody at runtime (Kerbin → Earth, Mun → Moon, Duna → Mars, …).
 * The runtime name is what the mod reports for v.body / o.referenceBody, so the
 * ids below are the RSS names, not the stock template names.
 *
 * Values are lifted from the RO install's RSS configs at
 * GameData/RealSolarSystem/RSSKopernicus/<Planet>/<Body>.cfg (radius,
 * gravParameter, rotationPeriod, atmosphere maxAltitude + staticPressureASL).
 * SOI is not set in those configs for these bodies, so it is the value KSP
 * computes itself: a·(m/M)^0.4, with a and the gravParameters taken from the
 * same configs. Atmospheric scale heights are real physical approximations
 * (the exponential AtmosphereModel is documented as approximate); RSS ships a
 * tabulated pressureCurve, not a single scale height.
 *
 * Map texture offsets are left as best-guess TODOs: RSS ships its own body
 * textures (not gonogo assets), so no `texture` is wired here and the
 * longitude/latitude offsets need empirical tuning against those textures once
 * a real map render is available.
 */

import { registerBody } from "./bodies";

export function registerRSSBodies(): void {
  // ── Star ───────────────────────────────────────────────────────────────
  // RSSKopernicus/Sun.cfg: real Sun. No KSP atmosphere block.
  registerBody({
    id: "Sun",
    name: "Sun",
    radius: 696342000,
    gm: 1.3271244e20,
    color: "#FFF44F",
    hasAtmosphere: false,
    maxAtmosphere: 0,
  });

  // ── Earth (stock template: Kerbin) ───────────────────────────────────────
  // RSSKopernicus/Earth/Earth.cfg. SOI = a·(m/M)^0.4 ≈ 9.2465e8 m (~924,600 km).
  registerBody({
    id: "Earth",
    name: "Earth",
    radius: 6371000,
    gm: 3.98600435e14,
    soi: 924649200,
    color: "#4B6F9B",
    parent: "Sun",
    // TODO: tune against the RSS Earth texture once a real map render exists.
    longitudeOffset: 0,
    latitudeOffset: 0,
    hasAtmosphere: true,
    maxAtmosphere: 140000,
    // 1 atm at sea level; scale height ~8.5 km.
    atmosphere: { surfacePressure: 101_325, scaleHeight: 8_500 },
    rotationPeriod: 86164.0989,
  });

  // ── Moon (stock template: Mun) ───────────────────────────────────────────
  // RSSKopernicus/Earth/Moon.cfg. Tidally locked; rotationPeriod = orbital
  // period around Earth. SOI ≈ 6.6167e7 m (~66,170 km).
  registerBody({
    id: "Moon",
    name: "Moon",
    radius: 1737100,
    gm: 4.90280007e12,
    soi: 66167160,
    color: "#9A9A9A",
    parent: "Earth",
    hasAtmosphere: false,
    maxAtmosphere: 0,
    rotationPeriod: 2360584.685,
  });

  // ── Mars (stock template: Duna) ──────────────────────────────────────────
  // RSSKopernicus/Mars/Mars.cfg. radius = RSS datum. SOI ≈ 5.7725e8 m
  // (~577,254 km).
  registerBody({
    id: "Mars",
    name: "Mars",
    radius: 3375800,
    gm: 4.28283736e13,
    soi: 577254100,
    color: "#C1440E",
    parent: "Sun",
    longitudeOffset: 0,
    latitudeOffset: 0,
    hasAtmosphere: true,
    maxAtmosphere: 125000,
    // ~6.1 mbar at datum (staticPressureASL 1.14497 kPa); scale height ~11.1 km.
    atmosphere: { surfacePressure: 1_144.97, scaleHeight: 11_100 },
    rotationPeriod: 88642.6848,
  });

  // ── Venus (stock template: Duna) ─────────────────────────────────────────
  // RSSKopernicus/Venus/Venus.cfg. rotationPeriod is retrograde in the config
  // (-20,996,797 s); stored here as its magnitude to match the positive-period
  // convention. SOI ≈ 6.1628e8 m (~616,281 km).
  registerBody({
    id: "Venus",
    name: "Venus",
    radius: 6049000,
    gm: 3.24858592e14,
    soi: 616280854,
    color: "#C9A46B",
    parent: "Sun",
    longitudeOffset: 0,
    latitudeOffset: 0,
    hasAtmosphere: true,
    maxAtmosphere: 145000,
    // ~92 atm at datum (staticPressureASL 10,905.2 kPa); scale height ~15.9 km.
    atmosphere: { surfacePressure: 10_905_200, scaleHeight: 15_900 },
    rotationPeriod: 20996797.02,
  });
}
