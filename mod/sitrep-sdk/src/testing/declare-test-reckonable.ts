import type { GeneratedReckonableInput } from "../__generated__/reckonability";
import { appendReckonableRows } from "../contract-tags";

/**
 * Declares that `owner`'s contract marks `fields` of `topic` reckonable, as its
 * codegen would from a `[SitrepReckonable]` mark, so a test can register a model
 * on a Topic only the test knows. A model is refused on a value its owner never
 * marked, in a test as anywhere else.
 *
 * `fields` defaults to the whole payload, which suits a Topic whose payload is
 * one number. Useful for testing how a widget shows a reckoned figure for a
 * vessel that is behind a signal delay.
 *
 * @category Stream fixture
 */
export function declareTestReckonable(
  topic: string,
  owner: string,
  fields: readonly string[] = [""],
  inputs: readonly GeneratedReckonableInput[] = [],
): void {
  appendReckonableRows(
    owner,
    fields.map((field) => ({
      topic,
      field,
      basis: "rate-integration",
      inputs,
    })),
  );
}
