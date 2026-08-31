/**
 * `@ksp-gonogo/ui-kit/render`: the NODE half of the Uplink render harness.
 *
 * esbuild, Playwright, the filesystem, the GIF encoder and the markdown
 * generator. Never reachable from a browser bundle, exactly as `./testing` is
 * never reachable from a runtime one.
 *
 * It ships from the design system rather than a package of its own for one
 * reason: the generated browser entry, the page it is injected into and the
 * `window` global it installs are a PAIRING, and a copy of a pairing drifting
 * from its original is this repo's most repeated harness bug. Splitting the pair
 * across two published packages with independent version numbers would
 * reintroduce that gap at the worst possible boundary. The obvious alternative,
 * a package above core that could import ui-kit freely, was
 * `@ksp-gonogo/sitrep-testing`, and that package existed and was deleted: the
 * harness was deliberately consolidated onto the two published packages'
 * subpaths, and this follows it.
 *
 * `playwright` and `esbuild` are OPTIONAL peers. A missing one fails with a
 * named message rather than a resolution error.
 */

/** The grid geometry a harness needs to size its mount box, re-exported here so
 *  a Node-side driver never has to import the browser half of the kit for it. */
export { COL_WIDTH, GRID_MARGIN, gridToPixels, ROW_HEIGHT } from "./gridUnits";
export {
  type ChannelDisposition,
  readChannelDispositions,
} from "./render/channels";
export { run } from "./render/cli";
export {
  display,
  type FontFace,
  type FontMode,
  jetbrainsMonoFace,
  resolveUplinkPackage,
  themeTokensCss,
  type UplinkPackage,
} from "./render/context";
export {
  buildManifest,
  buildReadme,
  type DocsInputs,
  type UplinkManifestJson,
} from "./render/docs";
export {
  type Engine,
  type RenderedAsset,
  type RenderOptions,
  type RenderResult,
  renderUplink,
} from "./render/driver";
export { encodeGif } from "./render/gif";
export type { MinFitFinding } from "./render/minFit";
export { buildProbePage, generateEntry } from "./render/page";
/** The `globalThis` key the probe installs itself under. A driver that drives
 *  the probe from Node needs the name and nothing else from that module. */
export { RENDER_PROBE_GLOBAL } from "./render/probe-global";
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
  readWireSurface,
  type WireChannel,
  type WireField,
  type WirePayload,
  type WireSurface,
  wireSection,
} from "./render/wire";
