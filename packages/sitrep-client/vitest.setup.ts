// The act-warning gate's post-body wait, imported only when the gate asks for it so
// an ordinary run never loads the testing barrel. Outside `src`, which may not
// runtime-import past the spine, and last, so its afterEach is ordered ahead of
// Testing Library's cleanup; see installActGateStretch.
if (process.env.GONOGO_ACT_GATE_STRETCH_FRAMES) {
  const { installActGateStretch } = await import(
    "@ksp-gonogo/sitrep-sdk/testing"
  );
  await installActGateStretch();
}

// A module, so the awaits above are top-level awaits.
export {};
