/**
 * Re-export. These accessors moved to `@ksp-gonogo/sitrep-client`, beside the
 * `Reading` type they destructure, once the migration reached the Uplink clients:
 * a widget in `mod/Gonogo*Uplink/client` cannot import this package's internals,
 * and `packages/app` cannot either, so a components-local home would have forced
 * two more copies of the same three decisions.
 *
 * Kept as a re-export rather than removed so the widgets that already import it
 * read the same either way. The doc comments explaining WHEN each is wrong live on
 * the definitions.
 */
export {
  dateable,
  judgeable,
  notCurrent,
  stillTrue,
} from "@ksp-gonogo/sitrep-client";
