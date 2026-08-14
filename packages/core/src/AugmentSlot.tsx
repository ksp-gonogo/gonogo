// Re-export shim: `AugmentSlot` + `useAugmentAvailable` moved to
// `@ksp-gonogo/ui-kit` alongside the augment registry they compose. Its
// presence gate now reads ui-kit's own domain-availability store (fed from
// telemetry by the app) rather than a spine hook, so the whole component ships
// from the published design floor. Every `@ksp-gonogo/core` importer stays
// byte-identical.
export { AugmentSlot, useAugmentAvailable } from "@ksp-gonogo/ui-kit";
