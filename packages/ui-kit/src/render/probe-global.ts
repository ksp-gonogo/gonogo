/**
 * The `window` key the two halves of the render harness talk over.
 *
 * Its own module, importing nothing, because both halves need the VALUE and one
 * of them runs in Node: reaching for it from `../render-probe` pulls that whole
 * browser module (React, styled-components, the sdk) into the Node bundle, and
 * the sdk resolves to TypeScript source inside this workspace, so the bin died on
 * an unresolvable import before it had parsed an argument.
 *
 * Naming it once is also the point: a second spelling of the handshake is free
 * to drift green, since a driver that installs one name and waits for another
 * simply times out somewhere far from the typo.
 */
export const RENDER_PROBE_GLOBAL = "__gonogoRenderProbe";
