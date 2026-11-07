import { registerComponent } from "@ksp-gonogo/core";
import { useCommand } from "@ksp-gonogo/sitrep-sdk/spine";
import { useState } from "react";
import { PLANTED_FACE_IDS } from "./plantedFaceWidgets.ids";

const COMMAND = "planted-face.press";

const ROW = { display: "flex", gap: 8, alignItems: "center" } as const;

/** Presses the command and reads the awaiting state off the handle, so the plant changes face when the stub holds the reply. */
function useAwaiting() {
  const handle = useCommand(COMMAND);
  return {
    handle,
    awaiting: handle.status?.phase === "in-flight",
    press: () => void handle.send({}).catch(() => undefined),
  };
}

/** A button that gains words while it waits for a reply, pushing the control beside it along the row. */
function Widens() {
  const { awaiting, press } = useAwaiting();
  return (
    <div style={ROW}>
      <button type="button" onClick={press}>
        {awaiting ? "SENT, AWAITING THE REPLY FROM THE VESSEL" : "GO"}
      </button>
      <span>neighbour</span>
    </div>
  );
}

/** A button that keeps its own box while a status line appears between it and the figure below. */
function Shifts() {
  const { awaiting, press } = useAwaiting();
  return (
    <div>
      <button type="button" onClick={press}>
        GO
      </button>
      {awaiting ? <div>Waiting for the reply</div> : null}
      <div>neighbour</div>
    </div>
  );
}

/** A button that changes its word while it waits but keeps a box of its own, so nothing beside it may move. */
function Steady() {
  const { awaiting, press } = useAwaiting();
  return (
    <div style={ROW}>
      <button type="button" style={{ width: 120 }} onClick={press}>
        {awaiting ? "SENT" : "GO"}
      </button>
      <span>neighbour</span>
    </div>
  );
}

/** A toggle that opens a panel below itself, which a fixture may name as allowed. */
function OpensPanel() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Details
      </button>
      {open ? <div>The panel</div> : null}
      <div>neighbour</div>
    </div>
  );
}

const PLANT = {
  tags: [] as string[],
  minSize: { w: 6, h: 4 },
  channels: [],
};

registerComponent({
  ...PLANT,
  id: PLANTED_FACE_IDS.widens,
  name: "Planted widening button",
  description: "A render harness plant: a button that widens when sent.",
  component: Widens,
});
registerComponent({
  ...PLANT,
  id: PLANTED_FACE_IDS.shifts,
  name: "Planted shifting neighbour",
  description: "A render harness plant: a status line pushes a neighbour down.",
  component: Shifts,
});
registerComponent({
  ...PLANT,
  id: PLANTED_FACE_IDS.steady,
  name: "Planted steady button",
  description:
    "A render harness plant: a fixed-width button that changes its word.",
  component: Steady,
});
registerComponent({
  ...PLANT,
  id: PLANTED_FACE_IDS.panel,
  name: "Planted panel toggle",
  description: "A render harness plant: a toggle that opens a panel below it.",
  component: OpensPanel,
});
