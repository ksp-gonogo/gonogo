import {
  classifyRequirement,
  getAugments,
  getComponents,
} from "@ksp-gonogo/core";
import { describe, expect, it } from "vitest";
/*
 * Side-effect imports: each Uplink client registers its widgets, augments and
 * Topics at module load, exactly as `main.tsx` gets them. Every one of the ten
 * is already a declared dependency of this package, so this costs no new edge.
 *
 * `components` is here for the same reason and it is not incidental. A built-in
 * widget may declare a channel an UPLINK owns (`space-weather` mounts on
 * `kerbalism.spaceweather`), and an Uplink's topic ids only enter the resolvable
 * set when that Uplink registers. So the components-side gate cannot classify
 * such an id from its own package and this is the only place that can: every
 * Uplink loaded, every widget registered, one resolvable vocabulary.
 */
import "@ksp-gonogo/components";
import "@ksp-gonogo/gonogo-avionics-uplink";
import "@ksp-gonogo/gonogo-breaking-ground-uplink";
import "@ksp-gonogo/gonogo-ferram-aerospace-research-uplink";
import "@ksp-gonogo/gonogo-kerbalism-uplink";
import "@ksp-gonogo/gonogo-kerbcast-uplink";
import "@ksp-gonogo/gonogo-kos-uplink";
import "@ksp-gonogo/gonogo-mechjeb-uplink";
import "@ksp-gonogo/gonogo-principia-uplink";
import "@ksp-gonogo/gonogo-real-fuels-uplink";
import "@ksp-gonogo/gonogo-realantennas-uplink";
import "@ksp-gonogo/gonogo-rp1-uplink";

/**
 * The Uplink half of `packages/components/src/test/widgetDeclarations.test.ts`.
 *
 * That gate reads the real registry and classifies every declaration entry, and
 * it says plainly what it cannot see: the widgets THIS package registers, and
 * nothing else. An Uplink's widgets register into the same registry from
 * packages `components` does not depend on, so their declarations are governed
 * by nothing there. Ten Uplinks, and `mod/*​/client` is where new widgets now go.
 *
 * ## Why it lives here rather than in each Uplink
 *
 * The obvious reading is that each Uplink client should run the assertion over
 * its own registrations, and that reading is wrong twice.
 *
 * A gate inside an Uplink cannot be run by the third-party authors those
 * Uplinks exist to model: `docs/uplink-isolation.md` forbids reaching for an
 * app-internal package from `mod/*​/client`, and `classifyRequirement` lives in
 * `@ksp-gonogo/core`, which is private and unpublished. This exact strategy was
 * tried and removed rather than allowlisted, and it is now a NAMED BAN in
 * `uplink-isolation.allowlist.ts`'s `BLOCKED_FILENAMES`, for the reason that a
 * gate living in the Uplink makes the first-party Uplinks less like the
 * third-party ones they model.
 *
 * And it would be ten copies of one assertion, each able to rot on its own.
 * The check does not need to be inside anything: it needs a place that already
 * imports every Uplink client legitimately and can also see `core`. That is
 * this package, which does both today, and where `main.tsx` already imports
 * most of them for real.
 *
 * So `classifyRequirement` does NOT need to move into `sitrep-sdk` for this
 * coverage to exist. It would need to move for an outside author to run the
 * same check on their own widgets, which is a separate and still-open question.
 *
 * ## What it asserts
 *
 * The registry, not the source. A regex over `dataRequirements:` arrays is how
 * the same vocabulary audit already went wrong in both directions at once,
 * matching mentions inside comments and missing every multi-line and
 * dynamically-built declaration. The registry is what the dashboard reads.
 *
 * An unresolvable entry is silent at runtime: `isTopicCarried` walks a field
 * path without checking that the leaf names a real field, so a typo renders as
 * a permanent `undefined` and costs the panel its stream-status badge and its
 * alarm matching. Nothing else can tell that from a value that has not arrived.
 *
 * ## Two registries, not one
 *
 * `getComponents()` is only half the surface an Uplink declares against.
 * Augments register into a SEPARATE registry and carry their own `channels`,
 * and four of them do. `getAugments()` is the enumeration that makes them
 * countable; `getAugmentsForSlot` cannot serve here, because reaching every
 * augment through it means knowing every slot name first, and a slot nobody
 * listed is exactly the augment nobody checks.
 */
type Declaration = { id: string; requirement: string };

function declarationsFromComponents(): Declaration[] {
  return getComponents().flatMap((def) =>
    [
      ...(def.dataRequirements ?? []),
      ...(def.fields ?? []),
      ...(def.channels ?? []),
      ...(def.optionalChannels ?? []),
    ].map((requirement) => ({ id: def.id, requirement })),
  );
}

function declarationsFromAugments(): Declaration[] {
  return getAugments().flatMap((def) =>
    (def.channels ?? []).map((requirement) => ({
      id: def.id,
      requirement: requirement as string,
    })),
  );
}

describe("widget and augment declarations resolve to something real", () => {
  /**
   * All four component arrays plus the augment registry, because
   * `dataRequirements` is not the array a migrated widget uses. Measured across
   * the ten clients at the time of writing: 23 `dataRequirements` entries and 5
   * `channels` on components, plus 6 `channels` on augments. Reading
   * `dataRequirements` alone left every entry in the new vocabulary outside the
   * gate, and the proportion moves that way with each migration.
   *
   * `channels` and `optionalChannels` are typed ids, so the compiler already
   * rejects a token that is neither a `TopicId` nor a derived-channel id. They
   * are included anyway: the typed union is a build-time claim about the id's
   * SPELLING, and this asserts the runtime registry resolves it, which is what
   * `useWidgetStreamStatus` and `alarmMatchesWidget` actually do. A widget
   * built against a stale SDK carries an id the current contract dropped, and
   * the two checks disagree exactly there.
   */
  const declared = [
    ...declarationsFromComponents(),
    ...declarationsFromAugments(),
  ];

  /**
   * The registry is global, so this sees the built-in widgets too if anything
   * in the import graph pulls `@ksp-gonogo/components` in. That is harmless
   * (the same assertion holds for them) but it means the count alone cannot
   * prove the Uplinks arrived, so the next tests name them.
   */
  it("found a non-trivial number of declarations (scan sanity check)", () => {
    expect(declared.length).toBeGreaterThan(10);
  });

  /**
   * The guard on the guard, and the one that matters here. A side-effect import
   * that silently resolves to an empty module, or an Uplink that stops
   * registering its widget, leaves the assertion below true about nothing. So
   * the widgets have to be present by NAME.
   */
  it("actually loaded the Uplinks' own widgets, so an empty result is not a pass", () => {
    const ids = new Set(getComponents().map((def) => def.id));
    // One widget from each Uplink that registers any, spelled out rather than
    // counted: a count cannot tell ten loaded Uplinks from one loaded ten
    // times, and one client failing to register is precisely the case where an
    // empty check reads as a clean one.
    const fromUplinks = [
      "avionics-go-no-go",
      "robotics-console",
      "ship-systems",
      "camera-feed",
      "kos-terminal",
      "mechjeb",
    ];
    const missing = fromUplinks.filter((id) => !ids.has(id));
    expect(missing).toEqual([]);
  });

  /**
   * The built-in half of the same guard. `components` is imported for the
   * cross-package channels it declares, so if that import stopped registering,
   * the entries it contributes would leave silently and every assertion below
   * would still pass.
   */
  it("actually loaded the built-in widgets, whose channels an Uplink owns", () => {
    const ids = new Set(getComponents().map((def) => def.id));
    const missing = ["space-weather", "crew-status", "ship-map"].filter(
      (id) => !ids.has(id),
    );
    expect(missing).toEqual([]);
  });

  /**
   * The same guard for the augment registry, which the widget names above
   * cannot speak for: augments are absent from `getComponents()` entirely, so
   * a client registering no augment leaves the augment half of `declared` empty
   * and every assertion over it vacuously true.
   */
  it("actually loaded the Uplinks' augments, which are a separate registry", () => {
    const ids = new Set(getAugments().map((def) => def.id));
    const fromUplinks = [
      "kerbcast-docking-camera",
      "realantennas-comm-signal-badge",
      "realantennas-comm-signal-section",
      "rp1-research-queue",
    ];
    const missing = fromUplinks.filter((id) => !ids.has(id));
    expect(missing).toEqual([]);
  });

  /**
   * The positive control on the WIDENING rather than on the classifier.
   * Dropping `channels` back out of the spread, or dropping the augment half,
   * leaves every assertion in this file passing over a smaller set: green, and
   * reading a fraction of what it claims. That is the state this gate was in
   * when it read `dataRequirements` alone, so each source has to be non-empty
   * by construction.
   */
  it("reads every declaration source that carries entries today", () => {
    const sources = [
      [
        "component dataRequirements",
        () => getComponents().flatMap((d) => d.dataRequirements ?? []).length,
      ],
      [
        "component channels",
        () => getComponents().flatMap((d) => d.channels ?? []).length,
      ],
      ["augment channels", () => declarationsFromAugments().length],
    ] as const;

    const empty = sources.filter(([, size]) => size() === 0).map(([n]) => n);

    expect(empty).toEqual([]);
  });

  it("classifies every declaration, no unresolvable entries", () => {
    const unresolvable = declared
      .filter(
        ({ requirement }) => classifyRequirement(requirement) === undefined,
      )
      .map(({ id, requirement }) => `${id}: ${requirement}`)
      .sort();

    expect(unresolvable).toEqual([]);
  });

  it("rejects a plausible-looking field that does not exist", () => {
    // The classifier's own positive control, kept here as well as in the
    // components-side gate: if these stop holding, the assertion above is
    // passing because the classifier went permissive, not because the
    // declarations are sound.
    expect(
      classifyRequirement("career.status.economy.notAField"),
    ).toBeUndefined();
    expect(classifyRequirement("vessel.state.notAField")).toBeUndefined();
    expect(classifyRequirement("career.status")).toBe("wire-topic");
  });
});
