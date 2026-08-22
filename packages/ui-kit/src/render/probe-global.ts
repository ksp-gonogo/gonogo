/**
 * The `window` key the two halves of the render harness talk over.
 *
 * Its own module, importing nothing, because both halves need the VALUE and one
 * of them runs in Node: reaching for it from `../render-probe` pulls that whole
 * browser module (React, styled-components, the sdk) into the Node bundle, and
 * the sdk resolves to TypeScript source inside this workspace, so the bin died on
 * an unresolvable import before it had parsed an argument.
 *
 * Naming it once is also the point. `PROBE_PAGES` exists in the first-party
 * harness for the same reason: a second spelling of the handshake is free to
 * drift green.
 */
export const RENDER_PROBE_GLOBAL = "__gonogoRenderProbe";
