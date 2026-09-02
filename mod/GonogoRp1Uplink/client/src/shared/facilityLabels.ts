/**
 * KSP's facility enum, spelled the way the building is signposted.
 *
 * <para>RP-1's own list writes these out through a localised lookup that reaches
 * KSP, which a reflection-only Uplink cannot call, so the stored name arrives as
 * the enum member and "VehicleAssemblyBuilding" is not a thing anybody says.</para>
 *
 * <para>Shared between the construction queue, which names a facility already
 * being upgraded, and the upgrade controls, which name one that could be. Two
 * copies of the table would let one surface call a building something the other
 * does not.</para>
 */
export const FACILITY_LABEL: Readonly<Record<string, string>> = {
  Administration: "Administration",
  AstronautComplex: "Astronaut Complex",
  LaunchPad: "Launch Pad",
  MissionControl: "Mission Control",
  ResearchAndDevelopment: "Research and Development",
  Runway: "Runway",
  SpaceplaneHangar: "Spaceplane Hangar",
  TrackingStation: "Tracking Station",
  VehicleAssemblyBuilding: "Vehicle Assembly Building",
};

/**
 * What to call a facility, falling back to the stored name.
 *
 * <para>A facility the table does not know keeps its enum member rather than
 * becoming a dash: an unrecognised building on a modded or KSCSwitcher site
 * still has to be identifiable.</para>
 */
export function facilityLabel(name: string): string {
  return FACILITY_LABEL[name] ?? name;
}
