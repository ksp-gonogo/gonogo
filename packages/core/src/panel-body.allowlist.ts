/**
 * Widget files that still give their `Panel` a body (children) instead of
 * `sections`, with how many such panels each has.
 *
 * SHRINK-ONLY. Entries may be lowered or removed, never added or raised. A new
 * entry means new code just wrote a body, which is the thing the gate exists to
 * stop; pass `sections` instead.
 *
 * Unlike most debt lists in this repo, THIS ONE HAS A REAL ZERO TO AIM AT. Every
 * entry here is a widget that can be converted, and the conversion is mechanical:
 * wrap each group in a `Section` with its `title`, hand the list to
 * `sections`, close the tag. What the widget gets back is Panel deciding how
 * those sections flow, so a landscape tile runs them in columns instead of
 * wasting its width on one.
 *
 * Regenerate after a conversion with:
 *
 *   node scripts/panel-body-debt.mjs --update
 *
 * See `styleguide-panel-body.test.ts` for what counts and `panel-body.scan.ts`
 * for the matcher itself.
 */
export const PANEL_BODY_DEBT: Record<string, number> = {
  "mod/GonogoKerbalismUplink/client/src/ShipSystems/index.tsx": 3,
  "mod/GonogoKerbalismUplink/client/src/SpaceWeather/index.tsx": 2,
  "mod/GonogoKosUplink/client/src/KosScriptTrigger/index.tsx": 1,
  "mod/GonogoKosUplink/client/src/KosTerminal/index.tsx": 2,
  "mod/GonogoMechJebUplink/client/src/MechJeb/index.tsx": 1,
  "mod/GonogoRp1Uplink/client/src/VehicleAssembly/index.tsx": 1,
  "packages/app/src/notes/NotesComponent.tsx": 1,
  "packages/components/src/ActionGroup/index.tsx": 2,
  "packages/components/src/AstronautComplex/index.tsx": 2,
  "packages/components/src/CareerEconomy/index.tsx": 1,
  "packages/components/src/CurrentOrbit/index.tsx": 1,
  "packages/components/src/FleetRoster/index.tsx": 1,
  "packages/components/src/Graph/index.tsx": 2,
  "packages/components/src/LandingStatus/index.tsx": 1,
  "packages/components/src/LaunchDirector/index.tsx": 2,
  "packages/components/src/LibrationPoints/index.tsx": 1,
  "packages/components/src/ManeuverPlanner/index.tsx": 1,
  "packages/components/src/MapView/index.tsx": 2,
  "packages/components/src/MissionEventLog/index.tsx": 2,
  "packages/components/src/Navball/index.tsx": 1,
  "packages/components/src/Objectives/index.tsx": 1,
  "packages/components/src/OrbitView/index.tsx": 1,
  "packages/components/src/PowerSystems/index.tsx": 4,
  "packages/components/src/ResourceOps/index.tsx": 2,
  "packages/components/src/ScienceData/index.tsx": 1,
  "packages/components/src/SemiMajorAxis/index.tsx": 2,
  "packages/components/src/Strategies/index.tsx": 3,
  "packages/components/src/SystemView/index.tsx": 1,
  "packages/components/src/TargetPicker/index.tsx": 2,
  "packages/components/src/Targeting/index.tsx": 3,
  "packages/components/src/TechTree/index.tsx": 5,
  "packages/components/src/ThermalStatus/index.tsx": 1,
  "packages/components/src/Twr/index.tsx": 3,
  "packages/components/src/WarpControl/index.tsx": 1,
  "packages/serial/src/InputTester/index.tsx": 1,
  "packages/serial/src/VirtualDevice/index.tsx": 2,
  "packages/ui-kit/src/render-probe.tsx": 1,
};

/**
 * The instrument check. Every other assertion in the gate is
 * `expect(offenders).toEqual([])`, and a scan that walks zero files satisfies
 * all of them: a wrong cwd, a scan root that no longer exists or a
 * `git ls-files` that errored into an empty string each look exactly like a
 * clean repo.
 *
 * Neither number counts the DEBT, on purpose. This list has a real zero to aim
 * at, and a floor under the debt population would be one the work has to walk
 * through: the shrink-only guard refuses to lower a floor, so clearing the last
 * widgets would have meant fighting the gate. `tags` counts every `<Panel>`
 * opening tag, the converted self-closing ones included, so it holds steady
 * while the debt falls and still fails if the walk stops finding panels.
 */
export const SCAN_FLOORS = {
  files: 188,
  tags: 48,
} as const;
