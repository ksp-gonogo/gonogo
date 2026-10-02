/**
 * Names a comment may put in code format although no source spells them: the
 * platform, a dependency or the game, which the tree only calls; an example
 * name a doc invents to show a pattern; a retired spelling a scan polices on
 * purpose. A name of our own that exists nowhere does not belong here: fix the
 * comment.
 */
export const EXTERNAL_IDENTIFIERS: ReadonlySet<string> = new Set([
  "AnalyserNode",
  "DelayNode",
  "MediaRecorder",
  "RTCEncodedVideoFrame",
  "RTCTransformEvent",
  "hydrateRoot",
  "onTrack",
  "srcObject",
  "pretendToBeVisual",
  "PropertyAssignment",
  "ExportDeclaration",
  "mergeConfig",
  "traceResolution",
  "resolutionMode",
  "peerDependency",
  "IStyledComponentBase",
  "AxisToButton",
  "useGamepad",
  "designMode",
  "GetLevelCount",
  "noUselessElse",
  "WorkingStageInfo",
  "StaleGrade",
  "ToWireVesselParts",
]);
