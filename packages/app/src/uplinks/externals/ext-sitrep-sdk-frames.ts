// The `/frames` subpath needs its OWN entry for the same reason `/media` and
// `/spine` do: the import map is keyed on exact specifiers, so
// `@ksp-gonogo/sitrep-sdk` alone resolves nothing for a subpath import and a
// runtime-loaded Uplink that names `/frames` fails to link at load.
//
// `/frames` re-exports the same `reference-frame` module `/spine` does, so this
// chunk and `ext-sitrep-sdk-spine` reach one copy of it: a single Rollup build
// keeps a module in exactly one chunk, and that is what makes a `FrameInstant`
// built through either specifier the same declaration rather than a lookalike.
export * from "@ksp-gonogo/sitrep-sdk/frames";
