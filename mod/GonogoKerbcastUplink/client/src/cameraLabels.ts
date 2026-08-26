// Re-exports from the shared @ksp-gonogo/kerbcast-react package, where the
// implementation lives. gonogo consumers (CameraFeed picker, Targeting docking
// HUD) import from this module.
//
// The shared buildCameraLabeler joins with " - " (hyphen-space, never an
// em-dash), so a camera label reads "NavCam - Clamp-O-Tron Docking Port Jr.".
export {
  buildCameraLabeler,
  type LabelableCamera,
} from "@ksp-gonogo/kerbcast-react";
