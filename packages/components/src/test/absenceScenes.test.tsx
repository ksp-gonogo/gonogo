import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ComponentProps } from "@ksp-gonogo/core";
import { getComponents, useTelemetry } from "@ksp-gonogo/core";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import type { ComponentType } from "react";
import { describe, expect, it } from "vitest";
import "../index";
import { absenceSceneFailures, textOf, withoutChannel } from "./absenceScene";
import { ABSENCE_SCENES } from "./absenceScenes";
import { snapshotWidgetMode } from "./widgetDomSnapshot";

const SRC = resolve(import.meta.dirname, "..");

/**
 * Where to write each scene's two rendered texts, for reading a failure.
 *
 * A failed assertion here names a string and says which side it was on, which
 * is enough to know the scene is wrong and not enough to know what the widget
 * drew instead. Set `ABSENCE_DUMP=<dir>` and the pair is on disk to compare.
 */
const DUMP = process.env.ABSENCE_DUMP;

async function renderPair(scene: (typeof ABSENCE_SCENES)[number]) {
  const def = getComponents().find((d) => d.id === scene.widget);
  if (!def) {
    throw new Error(
      `absence scene "${scene.id}" names widget "${scene.widget}", which is ` +
        "not registered.",
    );
  }
  const fixture = JSON.parse(readFileSync(join(SRC, scene.fixture), "utf8"));
  const Widget = def.component as ComponentType<
    ComponentProps<Record<string, unknown>>
  >;
  const healthy = await snapshotWidgetMode({
    Widget,
    fixture,
    mode: scene.mode,
  });
  const degraded = await snapshotWidgetMode({
    Widget,
    fixture: withoutChannel(fixture, scene.channel),
    mode: scene.mode,
  });
  if (DUMP !== undefined) {
    mkdirSync(DUMP, { recursive: true });
    writeFileSync(
      join(DUMP, `${scene.id}.txt`),
      `# present\n${textOf(healthy)}\n\n# missing ${scene.channel}\n${textOf(degraded)}\n`,
    );
  }
  return { healthy, degraded };
}

describe("absence scenes", () => {
  for (const scene of ABSENCE_SCENES) {
    it(`${scene.widget} without ${scene.channel} @ ${scene.mode.name}`, async () => {
      const { healthy, degraded } = await renderPair(scene);
      expect(
        absenceSceneFailures(scene, healthy, degraded),
        `${scene.expects}\n\nThis input can be missing because ${scene.because}.`,
      ).toEqual([]);
    });
  }
});

/**
 * Two widgets that mishandle a missing input, through the same check the
 * scenes above run through.
 *
 * A harness that cannot be shown to fail on a widget that mishandles absence is
 * not a harness, and the two plants fail DIFFERENTLY on purpose: one draws a
 * number it does not have and the other draws the same picture either way. The
 * first passes the difference check and the second passes the treatment check,
 * so a single plant would leave half the instrument unwitnessed.
 */
const PLANT_FIXTURE = {
  _stream: {
    carriedChannels: ["vessel.flight"],
    pinnedUt: 1000,
    emits: [
      {
        channel: "vessel.flight",
        value: { latitude: 0, longitude: 75, altitudeAsl: 85000 },
      },
    ],
  },
};

const PLANT_SCENE = {
  channel: "vessel.flight",
  withholds: ["85000"],
  showsMore: [NULL_DISPLAY],
};

const PLANT_MODE = { name: "plant", w: 6, h: 4 };

/** Draws a figure it has not been given, as a zero. */
function ZeroFallbackAltimeter() {
  const reading = useTelemetry("vessel.flight");
  const alt =
    reading.state === "observed"
      ? reading.value.altitudeAsl?.magnitude
      : undefined;
  return <div>ALT {alt ?? 0} m</div>;
}

/** Draws the same figure whatever arrived. */
function HardcodedAltimeter() {
  useTelemetry("vessel.flight");
  return <div>ALT 85000 m</div>;
}

describe("the check can see a widget that mishandles a missing input", () => {
  it("catches a figure drawn as a zero the wire never sent", async () => {
    const healthy = await snapshotWidgetMode({
      Widget: ZeroFallbackAltimeter,
      fixture: PLANT_FIXTURE,
      mode: PLANT_MODE,
    });
    const degraded = await snapshotWidgetMode({
      Widget: ZeroFallbackAltimeter,
      fixture: withoutChannel(PLANT_FIXTURE, "vessel.flight"),
      mode: PLANT_MODE,
    });
    const failures = absenceSceneFailures(PLANT_SCENE, healthy, degraded);
    expect(failures.join("\n")).toContain(NULL_DISPLAY);
  });

  it("catches a render that is the same picture either way", async () => {
    const healthy = await snapshotWidgetMode({
      Widget: HardcodedAltimeter,
      fixture: PLANT_FIXTURE,
      mode: PLANT_MODE,
    });
    const degraded = await snapshotWidgetMode({
      Widget: HardcodedAltimeter,
      fixture: withoutChannel(PLANT_FIXTURE, "vessel.flight"),
      mode: PLANT_MODE,
    });
    const failures = absenceSceneFailures(PLANT_SCENE, healthy, degraded);
    expect(failures.join("\n")).toContain("byte-identical");
  });

  it("refuses a scene that asserts nothing", () => {
    expect(
      absenceSceneFailures(
        { channel: "vessel.flight" },
        "<p>a</p>",
        "<p>b</p>",
      ),
    ).toHaveLength(1);
  });

  it("refuses a channel the fixture never emits", () => {
    expect(() => withoutChannel(PLANT_FIXTURE, "vessel.orbit")).toThrow(
      /never emits that channel/,
    );
  });
});
