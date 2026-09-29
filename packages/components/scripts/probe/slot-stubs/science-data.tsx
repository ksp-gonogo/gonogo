import { plantSlot, SlotStub } from "./stub";

plantSlot("science-data.aboard-row", ({ subjectId }) => (
  <SlotStub slot="science-data.aboard-row">{subjectId}</SlotStub>
));
