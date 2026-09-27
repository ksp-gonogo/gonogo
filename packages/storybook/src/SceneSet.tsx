import type { SceneEmit } from "@ksp-gonogo/uplink-tools/render-probe";
import { type ComponentType, useCallback, useEffect, useState } from "react";
import { UplinkScene, type UplinkSceneProps } from "./UplinkScene";
import { WidgetScene, type WidgetSceneProps } from "./WidgetScene";

/** A registered widget's scene, and the sample that must visibly change it. */
export interface WidgetSceneEntry extends Omit<WidgetSceneProps, "onMounted"> {
  kind: "widget";
  label: string;
  feed: { channel: string; value: unknown };
}

/** An Uplink's scene, and the sample that must visibly change it. */
export interface UplinkSceneEntry extends Omit<UplinkSceneProps, "onMounted"> {
  kind: "uplink";
  label: string;
  feed: SceneEmit;
}

export type SceneEntry = WidgetSceneEntry | UplinkSceneEntry;

export interface SceneSetProps {
  scenes: readonly SceneEntry[];
  /** What mounts each widget scene; the story component unless a plant swaps it. */
  widgetScene?: ComponentType<WidgetSceneProps>;
}

/** Feeds one mounted scene its entry's sample. */
type Feed = () => void;

/**
 * Every scene mounted side by side on one page, then checked: each drew
 * something, and feeding one scene changes that scene's text and no other's.
 *
 * The verdict is `data-check` on the set, `pending` until every scene has
 * mounted and the check has run.
 */
export function SceneSet({ scenes, widgetScene = WidgetScene }: SceneSetProps) {
  const Widget = widgetScene;
  const [feeds, setFeeds] = useState<ReadonlyMap<number, Feed>>(new Map());
  const [verdict, setVerdict] = useState<string>("pending");
  const slots = useSlots(scenes.length);

  const fedBy = useCallback(
    (index: number, feed: Feed) =>
      setFeeds((known) => new Map(known).set(index, feed)),
    [],
  );

  useEffect(() => {
    if (feeds.size < scenes.length) return;
    let live = true;
    checkIndependence(
      scenes.map((scene, index) => ({
        label: scene.label,
        el: slots.at(index),
        feed: feeds.get(index) ?? (() => {}),
      })),
    ).then(
      (fault) => live && setVerdict(fault ?? "pass"),
      (err: unknown) => live && setVerdict(`check threw: ${String(err)}`),
    );
    return () => {
      live = false;
    };
  }, [feeds, scenes, slots]);

  const state =
    verdict === "pending" ? "pending" : verdict === "pass" ? "pass" : "fail";
  return (
    <div data-check={state} data-check-fault={state === "fail" ? verdict : ""}>
      <output>{verdict}</output>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "var(--gap-panel-columns)",
        }}
      >
        {scenes.map((scene, index) => (
          <div key={scene.label} ref={slots.ref(index)}>
            {scene.kind === "widget" ? (
              <Widget
                {...scene}
                onMounted={(mount) =>
                  fedBy(index, () =>
                    mount.emit(scene.feed.channel, scene.feed.value),
                  )
                }
              />
            ) : (
              <UplinkScene
                {...scene}
                onMounted={(mount) =>
                  fedBy(index, () => mount.emit(scene.feed))
                }
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** One element ref per scene slot, stable across renders. */
function useSlots(count: number) {
  const [slots] = useState(() => {
    const els: (HTMLElement | null)[] = Array.from(
      { length: count },
      () => null,
    );
    const refs = els.map((_, index) => (el: HTMLElement | null) => {
      els[index] = el;
    });
    return {
      ref: (index: number) => refs[index],
      at: (index: number): HTMLElement | null => els[index] ?? null,
    };
  });
  return slots;
}

interface CheckedScene {
  label: string;
  el: HTMLElement | null;
  feed: Feed;
}

/** Each scene drew something, and each feed changes its own scene's text alone; the first fault, or null. */
async function checkIndependence(
  scenes: readonly CheckedScene[],
): Promise<string | null> {
  const read = () =>
    scenes.map((s) => (s.el?.textContent ?? "").replace(/\s+/g, " ").trim());
  let before = read();
  const blank = scenes.find((_, i) => before[i] === "");
  if (blank) return `${blank.label} drew nothing`;
  for (const [i, scene] of scenes.entries()) {
    scene.feed();
    await settle();
    const after = read();
    if (after[i] === before[i]) {
      return `${scene.label} did not change when fed`;
    }
    const moved = scenes.find((_, j) => j !== i && after[j] !== before[j]);
    if (moved) return `${moved.label} changed when ${scene.label} was fed`;
    before = after;
  }
  return null;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 300));
}
