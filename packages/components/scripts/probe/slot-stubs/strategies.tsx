import { PLANTED_UPLINK } from "../plantedUplink";
import { plantSlot, SlotStub } from "./stub";

/** The body slot draws only under a contributed screen, so the stub brings one that lists nothing and holds the body alone. */
PLANTED_UPLINK.registerContribution({
  id: "planted-slots-strategies-screen",
  contributes: "strategies.screens",
  requires: "planted",
  compute: () => [{ id: "planted-slots", label: "Planted", order: 0 }],
});

plantSlot("strategies.screen-body", ({ screenId }) => (
  <SlotStub slot="strategies.screen-body">screen: {screenId}</SlotStub>
));
