/**
 * The browser half of the min-size gate: every registration the app makes, plus
 * one widget that is deliberately broken and one whose form controls all fit.
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
import {
  Field,
  FieldLabel,
  Input,
  Panel,
  Select,
  Stack,
  StatusPill,
  Textarea,
} from "@ksp-gonogo/ui-kit";
import { defineRenderSetup } from "@ksp-gonogo/uplink-tools/render-probe";
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
 * Broken in all seven ways the audit can name, so a check that loses one of them
 * fails here rather than going quiet in the field.
 *
 * The two pills carry their words in a child span that fits, and are cut only
 * at their own edges. That is the shape the box checks exist for, and it is the
 * shape a check that has quietly gone back to judging text alone reports
 * nothing about.
 */
const CANARY_ID = "minsize-gate-canary";

/** Pinned rather than left to the pill's own padding, so what the canary proves
 *  is the audit still seeing a clipped box rather than the kit's spacing scale
 *  happening to overflow this week. */
const BARE_PILL = {
  padding: 0,
  border: 0,
  width: 120,
} as const;

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
        {/* Its box fits the panel and its value does not fit its box, which is
            the shape a text-only audit cannot see: the words are a value rather
            than a text node. */}
        <input
          aria-label="Canary clipped field"
          readOnly
          style={{ width: 40 }}
          value="A value no forty pixel field could show"
        />
        <div style={{ overflow: "hidden", width: 80 }}>
          <StatusPill
            $tone="warning"
            style={{ ...BARE_PILL, justifyContent: "flex-start" }}
          >
            <span style={{ width: 40 }}>FITS</span>
          </StatusPill>
        </div>
      </Panel>
      {/* Outside the panel, so their nearest clipping box is the tile itself
          and the audit has to call these two escapes rather than cuts: the two
          are different symptoms and a check that collapsed them would stop
          being able to tell a badge painting over its neighbour from one being
          trimmed by its own panel. */}
      <span style={{ marginLeft: -160, whiteSpace: "nowrap" }}>
        A label pushed clean off the left edge of its tile
      </span>
      <StatusPill
        $tone="warning"
        style={{ ...BARE_PILL, marginLeft: -40, justifyContent: "flex-end" }}
      >
        <span style={{ width: 40 }}>FITS</span>
      </StatusPill>
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

/**
 * The planted PASS: form controls that fit, which must audit clean.
 *
 * The canary proves the control check can see a cut field. This proves it does
 * not call a field cut because it is a field: each one here shows its whole
 * value or placeholder with room to spare, including the two shapes most likely
 * to trip a measurement, a right-aligned number field with its spin buttons and a
 * select with its arrow.
 */
const FITS_ID = "minsize-gate-fits";

function Fits() {
  return (
    <Panel panelTitle="Fits">
      <Stack gap="related-dense">
        <Field>
          <FieldLabel htmlFor="fits-text">Name</FieldLabel>
          <Input id="fits-text" readOnly value="Kerbin" />
        </Field>
        <Input aria-label="Filter" placeholder="Filter" />
        <input
          aria-label="Altitude"
          readOnly
          style={{ width: "8em", textAlign: "right" }}
          type="number"
          value="100"
        />
        <Select aria-label="Body" defaultValue="mun">
          <option value="mun">Mun</option>
        </Select>
        <Textarea aria-label="Notes" readOnly rows={2} value="Go for launch" />
      </Stack>
    </Panel>
  );
}

registerComponent({
  id: FITS_ID,
  name: "Min-size gate fitting controls",
  description:
    "Registered only inside the min-size gate's probe page: proves the audit passes form controls that fit.",
  tags: ["diagnostics"],
  component: Fits,
  dataRequirements: [],
  defaultSize: { w: 6, h: 8 },
  minSize: { w: 4, h: 6 },
});

/**
 * The planted pair for the overflow mask, which needs BOTH halves to mean
 * anything.
 *
 * `Panel.Glow` paints a fixed 44px box over the bottom of the body the moment
 * the body overflows by a single pixel, and about seventeen of those pixels are
 * opaque enough to erase the faint text a widget's empty state is drawn in. So
 * a body that overflows by a few pixels has a line covered where it sits, and a
 * body that overflows by a few hundred has the same line covered as the "more
 * below" cue it is meant to be. One of those is a defect and the other is the
 * affordance working.
 *
 * A check that reported every masked scroller would call both broken and still
 * come back green on the canary, which is why the honest one is planted too.
 */
const MASKED_ID = "minsize-gate-masked";
const SCROLLS_ID = "minsize-gate-scrolls";

/**
 * Pushes the line below the fold by a few pixels and no more.
 *
 * Measured rather than reasoned: at 3x3 the panel's body scroller is 89px and
 * its own title unit and insets take 85 of them around a single 22px line, so
 * twelve more pixels overflow it by eight and leave thirteen of that line under
 * a mask reaching about seventeen. The number has to sit BETWEEN the overflow
 * and the mask, which is the whole point of the widget and not something CSS
 * can state. If the panel's chrome changes height the gate fails as BLIND
 * rather than going quiet, and retuning this is the fix.
 */
const MASKED_SPACER_PX = 12;

/** Deep enough that the body cannot fit it, shallow enough that the scroll it
 *  buys is smaller than the mask: the shape the finding exists for. */
function Masked() {
  return (
    <Panel panelTitle="Masked">
      {/* flexShrink, because the body is a flex column and will otherwise
          squeeze the spacer down until nothing overflows at all. */}
      <div style={{ flexShrink: 0, height: MASKED_SPACER_PX }} />
      <div style={{ flexShrink: 0, lineHeight: "22px" }}>Four</div>
    </Panel>
  );
}

registerComponent({
  id: MASKED_ID,
  name: "Min-size gate masked body",
  description:
    "Registered only inside the min-size gate's probe page: proves the audit still sees text the overflow glow covers where it sits.",
  tags: ["diagnostics"],
  component: Masked,
  dataRequirements: [],
  defaultSize: { w: 6, h: 6 },
  minSize: { w: 3, h: 3 },
});

/** The same mask over a body with a screenful below the fold, which must audit
 *  clean: here the glow is telling the truth. */
function Scrolls() {
  return (
    <Panel panelTitle="Scrolls">
      <div style={{ lineHeight: "22px" }}>
        {Array.from({ length: 40 }, (_, row) => `Row ${row + 1} of forty`).map(
          (label) => (
            <div key={label}>{label}</div>
          ),
        )}
      </div>
    </Panel>
  );
}

registerComponent({
  id: SCROLLS_ID,
  name: "Min-size gate honest scroller",
  description:
    "Registered only inside the min-size gate's probe page: proves the audit stays quiet about a scroller with a screenful below its fold.",
  tags: ["diagnostics"],
  component: Scrolls,
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
  var __minsizeFitsId: string;
  var __minsizeMaskedId: string;
  var __minsizeScrollsId: string;
}

globalThis.__minsizeCanaryId = CANARY_ID;
globalThis.__minsizeFitsId = FITS_ID;
globalThis.__minsizeMaskedId = MASKED_ID;
globalThis.__minsizeScrollsId = SCROLLS_ID;
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
