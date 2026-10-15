import { plantSlot, SlotStub } from "./stub";

plantSlot("vessel-catalog.updates", ({ vesselName, compact }) => (
  <SlotStub slot="vessel-catalog.updates">
    {compact ? vesselName.split(" ")[0] : vesselName}
  </SlotStub>
));
