/**
 * A scene staged with one input MISSING: carried, subscribed, never published.
 *
 * `stopsArriving` and this are not the same lever and do not stage the same
 * state. That one replays every emit and then drops the transport, so each
 * topic is `stale`: a real observation, held, with a UT saying how old it is.
 * This one never emits the topic at all, so the read is `pending`: there is no
 * observation to hold and no age to caption. A widget that handles one
 * correctly says nothing about how it handles the other, and the staleness
 * treatments in this tree (the HELD caption, the age) have nothing to draw from
 * a reading that never arrived.
 *
 * The channel stays in `carriedChannels` on purpose. Dropping it there would
 * stage an UNPROMOTED topic, which is a client misconfiguration; leaving it
 * stages the production case, a healthy Uplink that has not published this
 * topic.
 *
 * ## A missing REQUIRED channel is not a fiction
 *
 * `ComponentDefinition.channels` reads "the widget only mounts once every one
 * of these Topics is live". Nothing implements that. The orchestrator wraps
 * every widget in `RequiresGuard`, which resolves the declared channels to
 * their owning Uplink and gates on that Uplink's HEALTH; a healthy Uplink that
 * has published nothing on the topic leaves the widget mounted at full size
 * with a `pending` reading inside it, and `useWidgetStreamStatus` draws no
 * badge for that grade either. So the scenes below are staging a state an
 * operator can be looking at, not one the type system rules out.
 */

/** The `_stream` block, as much of it as staging an absence needs to see. */
interface StreamBlock {
  carriedChannels: string[];
  emits: Array<{ channel: string; value: unknown; meta?: unknown }>;
  [key: string]: unknown;
}

interface StreamFixture {
  _stream?: StreamBlock;
  [key: string]: unknown;
}

/**
 * The same fixture with `channel` never arriving.
 *
 * Refuses a channel the fixture does not emit, because the thing a silent
 * no-op produces here is a degraded scene identical to its healthy twin, which
 * is the exact reading this family exists to stop being drawn: a pair that does
 * not differ would then mean both "the widget ignores the absence" and "the
 * absence was never staged", with nothing to tell them apart.
 */
export function withoutChannel<T extends StreamFixture>(
  fixture: T,
  channel: string,
): T {
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
 *
 * The prose fields are the point. A degraded render that comes out different
 * from its healthy twin proves only that the fixture reached the widget; it
 * says nothing about whether what replaced the figure is honest. So every scene
 * has to write down what SHOULD be on screen, and the check below asserts that
 * rather than the difference alone.
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
  /**
   * Text the degraded render paints MORE often than its healthy twin.
   *
   * A count rather than presence, because the treatments are shared furniture:
   * an em dash and the word HELD are already somewhere on most panels, so
   * "appears in the degraded render" is satisfied by a render that withheld
   * nothing. One more of them is the observable consequence of one withheld
   * figure.
   */
  showsMore?: string[];
  /**
   * Text BOTH renders paint: the rest of the panel survives one missing input.
   *
   * A widget that blanks to its empty state the moment one input is late is a
   * second failure, and it satisfies every check above: the pair differs and
   * the figure is gone.
   */
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
 * sentences.
 *
 * Returns the list rather than asserting, so the planted mishandlers below can
 * be checked from the same function the real scenes run through. An instrument
 * that cannot be seen to fail reports success for both reasons, and a second
 * copy of these rules written to fail on purpose would be checking the copy.
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
    } else if (degraded.includes(text)) {
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
