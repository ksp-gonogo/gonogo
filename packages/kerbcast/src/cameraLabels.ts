// Re-exports from the shared @ksp-gonogo/kerbcast-react package.
// gonogo consumers (CameraFeed picker, DistanceToTarget docking HUD) import
// from this module; the implementation now lives in the shared package.
//
// Separator change: the shared buildCameraLabeler uses " - " (hyphen-space)
// where the old gonogo version used an em-dash. Camera labels across the UI
// now read "NavCam - Clamp-O-Tron Docking Port Jr." instead of "NavCam —
// Clamp-O-Tron Docking Port Jr.".
export {
  buildCameraLabeler,
  type LabelableCamera,
} from "@ksp-gonogo/kerbcast-react";
