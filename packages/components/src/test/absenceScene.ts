/**
 * A scene staged with one input missing: subscribed, never published.
 *
 * Not `stopsArriving`, which holds a real observation as `stale` with an age.
 * This never emits the topic, so the read is `pending`: nothing to hold and
 * no age to caption, staging a healthy Uplink that has not published.
 *
 * A missing required channel is a real operator state: `RequiresGuard` gates
 * on the owning Uplink's health, not on the topic being live, so the widget
 * stays mounted with a `pending` reading and no badge.
 */

/** The `_stream` block, as much of it as staging an absence needs to see. */
interface StreamBlock {
  emits: Array<{ channel: string; value: unknown; meta?: unknown }>;
  [key: string]: unknown;
}

interface StreamFixture {
  _stream?: StreamBlock;
  [key: string]: unknown;
}

/**
 * The same fixture with `channel` never arriving. Refuses a channel the
 * fixture does not emit, since a silent no-op would stage a scene identical
 * to its healthy twin.
 */
export function withoutChannel<Fixture extends StreamFixture>(
  fixture: Fixture,
  channel: string,
): Fixture {
  const stream = fixture._stream;
  if (!stream || !Array.isArray(stream.emits)) {
    throw new Error(
      `withoutChannel("${channel}"): this fixture has no "_stream" block, so ` +
        "it emits nothing and there is no arrival to withhold.",
    );
  }
  const kept = stream.emits.filter((e) => e.channel !== channel);
  if (kept.length === stream.emits.length) {
    const emitted = [...new Set(stream.emits.map((e) => e.channel))].sort();
    throw new Error(
      `withoutChannel("${channel}"): this fixture never emits that channel, ` +
        "so withholding it changes nothing and the degraded scene would be " +
        `its own healthy twin. Channels it emits: ${emitted.join(", ")}.`,
    );
  }
  return { ...fixture, _stream: { ...stream, emits: kept } };
}

/**
 * One scene, and what the widget owes an operator when the input is missing.
 * A render that differs from its healthy twin proves only that the fixture
 * arrived, so each scene states what should be on screen.
 */
export interface AbsenceScene {
  /** Slug for the render filenames and the test name. */
  id: string;
  /** Registered widget id. */
  widget: string;
  /** Fixture path relative to `packages/components/src/`. */
  fixture: string;
  /** The input withheld. */
  channel: string;
  /** Grid size to render at, chosen because the scene is about that shape. */
  mode: { name: string; w: number; h: number };
  /** Why this input can legitimately be missing on a running dashboard. */
  because: string;
  /** What the widget should do with it missing, in one sentence. */
  expects: string;
  /** Text the healthy render paints and the degraded one must not. */
  withholds?: string[];
  /** Text the degraded render paints more often than its healthy twin: a count, since an em dash or HELD is already on most panels. */
  showsMore?: string[];
  /** Text both renders paint: the rest of the panel must survive one missing input. */
  stillPaints?: string[];
}

/** Visible text of a render, tags stripped and whitespace collapsed. */
export function textOf(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function count(haystack: string, needle: string): number {
  if (needle === "") return 0;
  let n = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    n += 1;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return n;
}

/**
 * Every way this pair falls short of what the scene says the widget owes, as
 * sentences. Returned rather than asserted, so the planted mishandlers run
 * through the same rules as the real scenes.
 */
export function absenceSceneFailures(
  scene: Pick<
    AbsenceScene,
    "channel" | "withholds" | "showsMore" | "stillPaints"
  >,
  healthyHtml: string,
  degradedHtml: string,
): string[] {
  const failures: string[] = [];
  const healthy = textOf(healthyHtml);
  const degraded = textOf(degradedHtml);

  if ((scene.withholds?.length ?? 0) + (scene.showsMore?.length ?? 0) === 0) {
    failures.push(
      "the scene declares neither withholds nor showsMore, so it asserts " +
        "nothing about what the widget does with the input missing and would " +
        "pass whatever it drew",
    );
  }

  if (healthyHtml === degradedHtml) {
    failures.push(
      `the render is byte-identical with "${scene.channel}" never arriving, ` +
        "so whatever it draws for that input it is drawing without one",
    );
  }

  for (const text of scene.withholds ?? []) {
    if (!healthy.includes(text)) {
      failures.push(
        `withholds "${text}", which the HEALTHY render does not paint either, ` +
          "so the scene is asserting the absence of something that was never " +
          "there",
      );
      continue;
    }
    if (degraded.includes(text)) {
      failures.push(
        `"${text}" is still painted with "${scene.channel}" never arriving, ` +
          "so a figure with no reading behind it is on screen",
      );
    }
  }

  for (const text of scene.showsMore ?? []) {
    const before = count(healthy, text);
    const after = count(degraded, text);
    if (after <= before) {
      failures.push(
        `"${text}" appears ${after} time(s) with "${scene.channel}" missing ` +
          `and ${before} time(s) with it present, so the withheld figure was ` +
          "replaced by something else or by nothing",
      );
    }
  }

  for (const text of scene.stillPaints ?? []) {
    if (!degraded.includes(text)) {
      failures.push(
        `"${text}" is gone with "${scene.channel}" missing, so one late input ` +
          "took the rest of the panel with it",
      );
    }
  }

  return failures;
}
