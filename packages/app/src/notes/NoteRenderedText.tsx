import { useMemo } from "react";
import { extractTags, renderTemplate } from "./templating";
import { useTagValues } from "./useTagValues";

// No live schema backs the tags, so the empty set tells `renderTemplate` not to flag unknown ones.
const NO_KNOWN_KEYS: ReadonlySet<string> = new Set<string>();

/** A note body with every `{{...}}` tag it mentions replaced by that tag's live value. */
export function NoteRenderedText({ body }: Readonly<{ body: string }>) {
  const tags = useMemo(() => extractTags(body), [body]);
  const valueMap = useTagValues(tags);
  const text = useMemo(
    () =>
      renderTemplate(body, (k) => valueMap.get(k), {
        knownKeys: NO_KNOWN_KEYS,
      }),
    [body, valueMap],
  );
  return <>{text}</>;
}
