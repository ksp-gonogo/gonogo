import { PLANTED_UPLINK } from "../plantedUplink";
import {
  plantContribution,
  plantedSlotDomain,
  plantSlot,
  SlotStub,
} from "./stub";

/** The body slot draws only under a contributed screen, so the body's stub brings one that lists nothing and holds the body alone. */
PLANTED_UPLINK.registerContribution({
  id: "planted-slots-administration-building-screen",
  contributes: "administration-building.screens",
  requires: plantedSlotDomain("administration-building.screen-body"),
  compute: () => [{ id: "planted-slots", label: "Planted", order: 0 }],
});

plantSlot("administration-building.screen-body", ({ screenId }) => (
  <SlotStub slot="administration-building.screen-body">
    screen: {screenId}
  </SlotStub>
));

plantContribution("administration-building.screens", {
  compute: () => [
    {
      id: "planted-slot-screens",
      label: "administration-building.screens",
      order: 0,
    },
  ],
});
