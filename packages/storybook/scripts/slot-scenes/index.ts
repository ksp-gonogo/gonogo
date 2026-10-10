import type { ExtensionScene } from "../coverage";
import { SCENES as actionGroup } from "./action-group";
import { SCENES as astronautComplex } from "./astronaut-complex";
import { SCENES as commSignal } from "./comm-signal";
import { SCENES as contractManager } from "./contract-manager";
import { SCENES as crewStatus } from "./crew-status";
import { SCENES as deployedScience } from "./deployed-science";
import { SCENES as experiments } from "./experiments";
import { SCENES as fleetRoster } from "./fleet-roster";
import { SCENES as fuelStatus } from "./fuel-status";
import { SCENES as landingStatus } from "./landing-status";
import { SCENES as launchDirector } from "./launch-director";
import { SCENES as maneuverPlanner } from "./maneuver-planner";
import { SCENES as mapView } from "./map-view";
import { SCENES as orbitView } from "./orbit-view";
import { SCENES as powerSystems } from "./power-systems";
import { SCENES as resourceOps } from "./resource-ops";
import { SCENES as scienceData } from "./science-data";
import { SCENES as shipMap } from "./ship-map";
import { SCENES as spaceCenterStatus } from "./space-center-status";
import { SCENES as strategies } from "./strategies";
import { SCENES as systemView } from "./system-view";
import { SCENES as targetPicker } from "./target-picker";
import { SCENES as targeting } from "./targeting";
import { SCENES as techTree } from "./tech-tree";
import { SCENES as transferWindow } from "./transfer-window";
import { SCENES as warpControl } from "./warp-control";

/**
 * The scene a stub is shown on, where its host widget's own opening scene does
 * not draw the slot or the host is not a built-in widget: a fixture that holds
 * what the slot needs, a size, a config or a click that opens it.
 */
export const SLOT_SCENE_OVERRIDES: readonly ExtensionScene[] = [
  ...actionGroup,
  ...astronautComplex,
  ...commSignal,
  ...contractManager,
  ...crewStatus,
  ...deployedScience,
  ...experiments,
  ...fleetRoster,
  ...fuelStatus,
  ...landingStatus,
  ...launchDirector,
  ...maneuverPlanner,
  ...mapView,
  ...orbitView,
  ...powerSystems,
  ...resourceOps,
  ...scienceData,
  ...shipMap,
  ...spaceCenterStatus,
  ...strategies,
  ...systemView,
  ...targetPicker,
  ...targeting,
  ...transferWindow,
  ...techTree,
  ...warpControl,
];

/** The id a slot's stub registers under, as `slotStubId` in the stubs gives it; the generator cannot load that module, which renders. */
const slotStubId = (slot: string): string => `planted-slot:${slot}`;

/** A widget's declared extension points and the scene its page opens on. */
export interface SlotHost {
  widgetId: string;
  augmentSlots: readonly string[];
  contributionSlots: readonly string[];
  /** Repo-relative fixture path, size and config of the opening scene. */
  scene: Pick<ExtensionScene, "fixture" | "w" | "h" | "config">;
}

/**
 * Extension points designed to work together, lit at once in a story of their
 * own beside each point's story alone.
 */
export const COMBINED_SLOT_SCENES: readonly {
  widgetId: string;
  slots: readonly string[];
}[] = [
  // The body draws only on a contributed screen.
  {
    widgetId: "strategies",
    slots: ["strategies.screens", "strategies.screen-body"],
  },
  // Both mount in the docking view, the overlay over the camera's picture.
  { widgetId: "targeting", slots: ["targeting.camera", "targeting.overlay"] },
  // The base paints the surface the overlay is drawn over, in one projection.
  { widgetId: "map-view", slots: ["map-view.base", "map-view.overlay"] },
  // One per-kerbal source: its row tone summarises the meters under the row.
  {
    widgetId: "crew-status",
    slots: ["crew-status.meters", "crew-status.row-tone"],
  },
  // The part's tooltip lists the meters, then the status rows under them.
  {
    widgetId: "ship-map",
    slots: ["ship-map.part-meters", "ship-map.part-meta"],
  },
];

/** Widgets drawn with no panel, so with nowhere to mount the standard points. */
const PANELLESS_WIDGETS: ReadonlySet<string> = new Set(["ship-map"]);

/** The standard extension points every widget with a panel has: two its panel mounts, one it carries. */
export function standardSlots(widgetId: string): string[] {
  if (PANELLESS_WIDGETS.has(widgetId)) return [];
  return [`${widgetId}.sections`, `${widgetId}.actions`, `${widgetId}.badges`];
}

/**
 * A host's opening scene, grown so a stub has room: wide enough that the panel
 * header keeps its badges and actions rather than folding them into a chip,
 * and taller so a stub after the widget's own content is not below the fold.
 */
function roomFor(scene: SlotHost["scene"]): SlotHost["scene"] {
  return { ...scene, w: Math.max(scene.w, 12), h: scene.h + 6 };
}

/**
 * Every extension point's stub story: one per point a widget declares or
 * carries, lighting that point's stub alone, on the point's override scene or
 * else its host's opening scene; then one per designed-together group.
 */
export function slotScenes(hosts: readonly SlotHost[]): ExtensionScene[] {
  const overrides = new Map(SLOT_SCENE_OVERRIDES.map((e) => [e.id, e]));
  const sceneFor = (host: SlotHost, slot: string): ExtensionScene =>
    overrides.get(slotStubId(slot)) ?? {
      id: slotStubId(slot),
      widgetId: host.widgetId,
      ...roomFor(host.scene),
    };
  const scenes: ExtensionScene[] = [];
  const shown = new Set<string>();
  for (const host of hosts) {
    const slots = new Set([
      ...host.augmentSlots,
      ...host.contributionSlots,
      ...standardSlots(host.widgetId),
    ]);
    for (const slot of slots) {
      scenes.push({ ...sceneFor(host, slot), name: slot, lights: [slot] });
      shown.add(slotStubId(slot));
    }
  }
  for (const override of SLOT_SCENE_OVERRIDES) {
    if (shown.has(override.id)) continue;
    const slot = override.id.slice("planted-slot:".length);
    scenes.push({ ...override, name: slot, lights: [slot] });
  }
  for (const group of COMBINED_SLOT_SCENES) {
    const host = hosts.find((h) => h.widgetId === group.widgetId);
    if (!host) {
      throw new Error(
        `COMBINED_SLOT_SCENES names ${group.widgetId}, which declares no slots`,
      );
    }
    scenes.push({
      ...sceneFor(host, group.slots[0]),
      id: slotStubId(group.slots[0]),
      name: group.slots.join(" + "),
      lights: group.slots,
      combined: true,
    });
  }
  return scenes;
}

/** Contributions a stub brings with it, each mapped to the slot whose story shows it rather than one of its own. */
export const STUB_COMPANIONS: Readonly<Record<string, string>> = {
  // The screen the `strategies.screen-body` stub draws on.
  "planted:planted-slots-strategies-screen": "strategies.screen-body",
};

/** The id a slot's stub story registers under, which a companion's story is found by. */
export { slotStubId };
