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
    press: () =>
      void handle.dangerouslySendWithoutInput({}).catch(() => undefined),
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

/** A toggle that grows the block above it, which a fixture naming it as opening below must not excuse. */
function OpensAbove() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div style={{ height: open ? 60 : 20 }}>above</div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Details
      </button>
    </div>
  );
}

/** A paragraph that grows when its own toggle is pressed, the toggle naming it with aria-controls. */
function OwnsText() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ width: 160 }}>
      <span id="planted-owned-text">
        {open
          ? "The whole paragraph, long enough to wrap onto several lines in a narrow column."
          : "The start"}
      </span>{" "}
      <button
        type="button"
        aria-controls="planted-owned-text"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        More
      </button>
    </div>
  );
}

/** A toggle that swaps the words of what is below it, and shifts a neighbour sideways with its words unchanged. */
function Swaps() {
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
      <div>
        <span>{open ? "a much longer replacement" : "short"}</span>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <span style={{ display: "inline-block", width: open ? 100 : 50 }}>
          fixed
        </span>
        <span>neighbour</span>
      </div>
    </div>
  );
}

/** A toggle behind an inert overlay, which a person cannot press, that would open a panel and push a neighbour down. */
function BehindInert() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div {...{ inert: "" }}>
        <button type="button" onClick={() => setOpen((v) => !v)}>
          Behind
        </button>
        {open ? <div>The panel</div> : null}
      </div>
      <div>neighbour</div>
    </div>
  );
}

/** A disclosure whose summary reveals its own body, and nothing else on the widget. */
function Disclosure() {
  return (
    <details>
      <summary>Details</summary>
      <div>The body</div>
    </details>
  );
}

/** A tab strip whose selected tab grows when pressed, so the tab beside it is pushed sideways, with a mark that slides to the selected tab. */
function TabStrip() {
  const [selected, setSelected] = useState("second");
  return (
    <div
      role="tablist"
      aria-label="Planted tabs"
      style={{ position: "relative", display: "flex", gap: 8 }}
    >
      <span
        aria-hidden="true"
        className="planted-blob"
        style={{
          position: "absolute",
          top: 0,
          height: 2,
          left: selected === "first" ? 0 : 60,
          width: 40,
        }}
      />
      <button
        type="button"
        role="tab"
        aria-selected={selected === "first"}
        onClick={() => setSelected("first")}
      >
        {selected === "first" ? "First tab, selected" : "First"}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={selected === "second"}
        onClick={() => setSelected("second")}
      >
        Second
      </button>
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
registerComponent({
  ...PLANT,
  id: PLANTED_FACE_IDS.inert,
  name: "Planted inert toggle",
  description: "A render harness plant: a toggle behind an inert overlay.",
  component: BehindInert,
});
registerComponent({
  ...PLANT,
  id: PLANTED_FACE_IDS.disclosure,
  name: "Planted disclosure",
  description: "A render harness plant: a summary that opens its own body.",
  component: Disclosure,
});
registerComponent({
  ...PLANT,
  id: PLANTED_FACE_IDS.tabs,
  name: "Planted tab strip",
  description:
    "A render harness plant: a selected tab that grows and a mark that slides.",
  component: TabStrip,
});
registerComponent({
  ...PLANT,
  id: PLANTED_FACE_IDS.opensAbove,
  name: "Planted toggle that grows the block above",
  description:
    "A render harness plant: a toggle that resizes what is above it.",
  component: OpensAbove,
});
registerComponent({
  ...PLANT,
  id: PLANTED_FACE_IDS.owns,
  name: "Planted paragraph with its own toggle",
  description:
    "A render harness plant: a toggle that grows the paragraph it names.",
  component: OwnsText,
});
registerComponent({
  ...PLANT,
  id: PLANTED_FACE_IDS.swaps,
  name: "Planted swapped content",
  description:
    "A render harness plant: a toggle that swaps the words below it.",
  component: Swaps,
});
