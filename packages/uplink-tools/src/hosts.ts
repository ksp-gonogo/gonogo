/**
 * The app's own widgets, registered, for ONE purpose: drawing an Uplink's docs
 * page.
 *
 * ## Why this is a package of its own, and why it must stay one
 *
 * An Uplink's docs page shows its widgets, and some of those widgets are an
 * AUGMENT or a CONTRIBUTION into a widget that ships with the app. To draw one
 * honestly you need the host around it. The operator's ruling on ticket 221 is what
 * this package is:
 *
 * > "if it's for the production of the docs page for each uplink that will show
 * > the widgets and where any of the extensions sit, then I think that makes
 * > sense. But let's just make sure it's under its own specific export, because
 * > typically pulling the widgets into the UI kit is only for the docs page,
 * > right? It's not for anything else. So I think we should try and make sure
 * > that's a separate named export path."
 *
 * So: **this exists for the docs page and for nothing else.** It must not
 * become the route by which an Uplink starts importing the app's widgets for
 * real use. A separate package makes that legible in the manifest rather than
 * in a comment nobody reads, and it makes the intent enforceable in a way a
 * `ui-kit` subpath could not be:
 *
 *   - `@ksp-gonogo/ui-kit` is a RUNTIME dependency of an Uplink. This is a
 *     **devDependency**, named in `gonogo.renderWith` and imported by nothing.
 *     An Uplink that reaches for a widget in here has to move it to
 *     `dependencies` first, which is a visible act
 *   - `packages/core/src/uplink-isolation.test.ts` fails on exactly that move,
 *     and on any `import` of this package from an Uplink's client source
 *
 * The widgets are not re-exported. Nothing here has an API: importing the
 * module runs `@ksp-gonogo/components`' own `registerComponent` calls, which is
 * all the render harness needs to resolve a scene's `_scene.host`. There is
 * deliberately nothing to `import {}` from it.
 *
 * ## How the harness reaches it
 *
 * An Uplink names it in its client `package.json`:
 *
 *     "gonogo": { "renderWith": ["@ksp-gonogo/uplink-tools/hosts"] }
 *
 * In-repo Uplinks name a path instead
 * (`../../../packages/components/src/index.ts`), which is the same
 * registrations reached the short way. Both end up as one `await import(...)`
 * in the page the harness generates, ahead of the Uplink's own entry, because
 * the host has to exist before the augment registers against it.
 *
 * ## Why a stand-in is not enough, so this has to be the real widgets
 *
 * `render-probe.tsx`'s `standInHost` already synthesises a host for a scene
 * that names none, and it serves more cases than it looks like it should: an
 * augment mounts in its `Panel`, and `Panel` draws every host's `<id>.badges`
 * itself, so a badge contribution lands in a stand-in exactly as it lands in
 * the real widget. That is the whole of
 * `HOST_DRAWN_CONTRIBUTION_SEGMENTS = ["badges"]`.
 *
 * Every OTHER contribution slot is drawn by the host widget's own body, and a
 * stand-in's body is `() => null`. `strategies.screens`,
 * `space-center-status.facilities` and `astronaut-complex.readouts` are each a
 * `useContributions(...)` inside the widget. Standing in for those produces a
 * blank frame that reports success, which is measured (ticket 317) rather than
 * argued, and is why the refusal in `render/scenes.ts` stays where it is.
 *
 * A real host body is the only thing that draws them. That is this package.
 */
import "@ksp-gonogo/components";
