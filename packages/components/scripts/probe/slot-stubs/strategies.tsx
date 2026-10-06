import { PLANTED_UPLINK } from "../plantedUplink";
import {
  plantContribution,
  plantedSlotDomain,
  plantSlot,
  SlotStub,
} from "./stub";

/** The body slot draws only under a contributed screen, so the body's stub brings one that lists nothing and holds the body alone. */
PLANTED_UPLINK.registerContribution({
  id: "planted-slots-strategies-screen",
  contributes: "strategies.screens",
  requires: plantedSlotDomain("strategies.screen-body"),
  compute: () => [{ id: "planted-slots", label: "Planted", order: 0 }],
});

plantSlot("strategies.screen-body", ({ screenId }) => (
  <SlotStub slot="strategies.screen-body">screen: {screenId}</SlotStub>
));

plantContribution("strategies.screens", {
  compute: () => [
    { id: "planted-slot-screens", label: "strategies.screens", order: 0 },
  ],
});
