import { plantSlot, SlotStub } from "./stub";

plantSlot("action-group.subsystem", ({ label, stateLabel }) => (
  <SlotStub slot="action-group.subsystem">
    {label}: {stateLabel}
  </SlotStub>
));
