// Re-export shim: `WidgetMetaContext` moved to `@ksp-gonogo/ui-kit` alongside
// the contribution read seam it feeds. Every `@ksp-gonogo/core` importer stays
// byte-identical.
export {
  useWidgetMeta,
  WidgetMetaContext,
  type WidgetMetaContextValue,
} from "@ksp-gonogo/ui-kit";
