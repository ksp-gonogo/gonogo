import { PLANTED_UPLINK } from "../plantedUplink";
import {
  plantContribution,
  plantedSlotDomain,
  plantSlot,
  SlotStub,
} from "./stub";

/** The body slot draws only under a contributed screen, so the body's stub brings one that lists nothing and holds the body alone. */
PLANTED_UPLINK.registerContribution({
  id: "planted-slots-admin-building-screen",
  contributes: "admin-building.screens",
  requires: plantedSlotDomain("admin-building.screen-body"),
  compute: () => [{ id: "planted-slots", label: "Planted", order: 0 }],
});

plantSlot("admin-building.screen-body", ({ screenId }) => (
  <SlotStub slot="admin-building.screen-body">screen: {screenId}</SlotStub>
));

plantContribution("admin-building.screens", {
  compute: () => [
    { id: "planted-slot-screens", label: "admin-building.screens", order: 0 },
  ],
});
