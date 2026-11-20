import { PerfBudget } from "@ksp-gonogo/core";
import { useTelemetryClientOptional } from "@ksp-gonogo/sitrep-client";
import { useEffect, useState } from "react";

/** The namespace each body's surface map is published under. */
export const BODY_TEXTURE_TOPIC_PREFIX = "bodies.texture.";

const KEPT_AS_IS = /^[A-Za-z0-9_-]$/;

/**
 * The topic carrying the surface map of the body the stream names `bodyId`.
 * The name is one topic segment: its UTF-8 bytes, letters, digits, `_` and `-`
 * as they are and every other byte as `%XX`, as the mod writes it.
 */
export function bodyTextureTopic(bodyId: string): string {
  let key = "";
  for (const byte of new TextEncoder().encode(bodyId)) {
    const char = String.fromCharCode(byte);
    key += KEPT_AS_IS.test(char)
      ? char
      : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return BODY_TEXTURE_TOPIC_PREFIX + key;
}

/**
 * Maps received from the mod, per second. Each body's map arrives once per
 * subscription; a sustained rate means something is resubscribing in a loop.
 */
const BODY_TEXTURE_BUDGET = new PerfBudget({
  name: "Body maps received/sec",
  threshold: 10,
  windowMs: 1000,
  unit: "maps",
});

/*
 * One object URL per body, shared by every widget drawing it, and replaced
 * (the old one revoked) only when a different payload arrives for that body.
 */
const urls = new Map<string, { png: Uint8Array; url: string }>();

function urlFor(topic: string, png: Uint8Array): string {
  const kept = urls.get(topic);
  if (kept?.png === png) return kept.url;
  BODY_TEXTURE_BUDGET.record();
  if (kept) URL.revokeObjectURL(kept.url);
  // A segment is a view on bytes read off a socket or a peer link, never on shared memory.
  const bytes = png as Uint8Array<ArrayBuffer>;
  const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
  urls.set(topic, { png, url });
  return url;
}

/**
 * A URL for the surface map of the body the stream names `bodyId`, as the mod
 * reads it from the running game: an equirectangular PNG with north up and
 * east to the right. `undefined` until the mod has answered, and `null` once
 * it has said the game has no map for that body, such as for the Sun.
 *
 * Opening it is what makes the mod read the body's map, once per body for the
 * whole game. A map is the same for every command centre and is not delayed.
 */
export function useBodyTextureUrl(
  bodyId: string | undefined,
): string | null | undefined {
  const client = useTelemetryClientOptional();
  const topic = bodyId ? bodyTextureTopic(bodyId) : undefined;
  const [answer, setAnswer] = useState<
    { topic: string; url: string | null } | undefined
  >(undefined);

  useEffect(() => {
    if (!client || !topic) return;
    return client.subscribe(topic, (segments) => {
      const png = Array.isArray(segments) ? segments[0] : undefined;
      setAnswer({
        topic,
        url:
          png instanceof Uint8Array && png.byteLength > 0
            ? urlFor(topic, png)
            : null,
      });
    });
  }, [client, topic]);

  if (!topic || !answer || answer.topic !== topic) return undefined;
  return answer.url;
}
