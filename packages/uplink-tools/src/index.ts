/**
 * `@ksp-gonogo/uplink-tools`: the Node half of the Uplink toolchain behind the
 * `uplink-tools` command. It bundles an Uplink with esbuild, renders its scenes
 * in Playwright, encodes GIFs and writes the generated page. Never import it from a browser bundle; the browser half is
 * `./render-probe`.
 *
 * `playwright` and `esbuild` are optional peers. A missing one fails with a
 * message naming it rather than a resolution error.
 */

export { gridToPixels } from "@ksp-gonogo/ui-kit/grid";
export { run } from "./cli";
export {
  type ChannelDisposition,
  readChannelDispositions,
} from "./render/channels";
export { resolveUplinkPackage, type UplinkPackage } from "./render/context";
export {
  buildManifest,
  buildReadme,
  type DocsInputs,
  type UplinkManifestJson,
  widgetRecordsOf,
} from "./render/docs";
export {
  type Engine,
  type RenderedAsset,
  type RenderOptions,
  type RenderResult,
  renderUplink,
} from "./render/driver";
export type { MinFitFinding } from "./render/minFit";
export { buildProbePage } from "./render/page";
/** The `globalThis` key the probe installs itself under. A driver that drives
 *  the probe from Node needs the name and nothing else from that module. */
export { RENDER_PROBE_GLOBAL } from "./render/probe-global";
export type {
  FixtureFile,
  FixtureScene,
  FixtureStream,
} from "./render/sceneModel";
export {
  assertEveryWidgetCovered,
  buildScenes,
  type Scene,
} from "./render/scenes";
export {
  type AssetShape,
  compareShapes,
  describeStale,
  readShapeRecord,
  SHAPE_RECORD_FILE,
  SHAPE_RECORD_VERSION,
  type ShapeRecord,
  type ShapeVerdict,
} from "./render/shape";
export {
  buildUplinkSpec,
  SPEC_FILE,
  SPEC_VERSION,
  type UplinkSpec,
  uplinkSpecJson,
} from "./render/spec";
export {
  WIDGET_RECORDS_FILE,
  type WidgetRecord,
  widgetRecordsJson,
} from "./render/widgetRecord";
export {
  readWireSurface,
  type WireChannel,
  type WireField,
  type WirePayload,
  type WireSurface,
  wireSection,
} from "./render/wire";
