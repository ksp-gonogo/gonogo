import { plantSlot, SlotStub } from "./stub";

plantSlot("fleet-roster.updates", ({ vesselName, compact }) => (
  <SlotStub slot="fleet-roster.updates">
    {compact ? vesselName.split(" ")[0] : vesselName}
  </SlotStub>
));
