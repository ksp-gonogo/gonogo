import { plantSlot, SlotStub } from "./stub";

plantSlot("deployed-science.experiment", ({ experiment, body }) => (
  <SlotStub slot="deployed-science.experiment">
    {experiment.name} · {body}
  </SlotStub>
));
