/**
 * The browser half of the min-size gate: every registration the app makes, plus
 * one widget that is deliberately broken.
 *
 * Bundled as the render probe's entry (see `minsize-gate.ts`), so it runs AFTER
 * `installRenderProbe()` and after the registration modules the gate names.
 * Everything registered by then is what the app registers, which is the whole
 * point: a gate that swept only the built-in library would miss the widgets that
 * are worst at this, since the widgets that ellipsise their own title at their
 * own minimum are disproportionately Uplink-authored.
 */
import { getComponents, registerComponent } from "@ksp-gonogo/core";
import { SerialDeviceProvider, SerialDeviceService } from "@ksp-gonogo/serial";
import { Panel } from "@ksp-gonogo/ui-kit";
import { defineRenderSetup } from "@ksp-gonogo/ui-kit/render-probe";
import { NotesHostProvider } from "../src/notes/NotesHostContext";
import { NotesHostService } from "../src/notes/NotesHostService";

/**
 * The two app-level contexts a widget can't be mounted without.
 *
 * `InputTester` and `Notes` both THROW outside their provider, so with nothing
 * here they crash the page instead of rendering and the gate audits a tile that
 * was never drawn. The app mounts both around the whole dashboard, so wrapping
 * every widget in them is what the app does, not a concession to the harness.
 * Everything else a widget needs (theme, telemetry, the widget host) the render
 * probe already mounts.
 */
const serialService = new SerialDeviceService({ screenKey: "minsize-gate" });
const notesService = new NotesHostService();

defineRenderSetup({
  wrap: (tree) => (
    <SerialDeviceProvider service={serialService}>
      <NotesHostProvider service={notesService}>{tree}</NotesHostProvider>
    </SerialDeviceProvider>
  ),
});

/**
 * The planted violation, so the gate can see its own failure.
 *
 * A fit check measures a real layout, and a real layout is exactly the thing
 * that can stop happening: a bundling change that mounts nothing, a probe that
 * throws before the audit, a selector that stops matching. Every one of those
 * makes the audit return an empty array, and an empty array reads as "everything
 * fits". So the gate mounts this widget too and REFUSES to report on the others
 * unless this one comes back broken.
 *
 * Broken in all three ways the audit can name, so a check that loses one of them
 * fails here rather than going quiet in the field.
 */
const CANARY_ID = "minsize-gate-canary";

function Canary() {
  return (
    <>
      <Panel panelTitle="A DELIBERATELY UNREASONABLE TITLE THAT NO TILE THIS SIZE COULD EVER HOLD">
        <div style={{ overflow: "hidden", height: 24 }}>
          <div style={{ height: 400 }}>
            Four hundred pixels of text behind a twenty-four pixel window with
            nothing to scroll
          </div>
        </div>
      </Panel>
      {/* Outside the panel, so its nearest clipping box is the tile itself and
          the audit has to call this one `escapes-tile` rather than cut off:
          the two are different symptoms and a check that collapsed them would
          stop being able to tell a badge painting over its neighbour from one
          being trimmed by its own panel. */}
      <span style={{ marginLeft: -160, whiteSpace: "nowrap" }}>
        A label pushed clean off the left edge of its tile
      </span>
    </>
  );
}

registerComponent({
  id: CANARY_ID,
  name: "Min-size gate canary",
  description:
    "Registered only inside the min-size gate's probe page: proves the audit can still see a widget that does not fit.",
  tags: ["diagnostics"],
  component: Canary,
  dataRequirements: [],
  defaultSize: { w: 6, h: 6 },
  minSize: { w: 3, h: 3 },
});

/** One widget, as the Node half needs it. */
export interface MinSizeWidget {
  id: string;
  name: string;
  minSize?: { w: number; h: number };
  defaultSize?: { w: number; h: number };
  /** Topics the stream fixture must carry, so the widget renders the empty
   *  state it shows in the app rather than "not carried on this install". */
  carried: string[];
}

declare global {
  var __minsizeWidgets: () => MinSizeWidget[];
  var __minsizeCanaryId: string;
}

globalThis.__minsizeCanaryId = CANARY_ID;
globalThis.__minsizeWidgets = () =>
  getComponents().map((def) => ({
    id: def.id,
    name: def.name,
    minSize: def.minSize ? { ...def.minSize } : undefined,
    defaultSize: def.defaultSize ? { ...def.defaultSize } : undefined,
    carried: [
      ...new Set([
        ...(def.channels ?? []),
        ...(def.optionalChannels ?? []),
        ...(def.dataRequirements ?? []).map((r) =>
          typeof r === "string" ? r : String(r),
        ),
      ]),
    ],
  }));
