import "./setup";
import { gridToPixels } from "@ksp-gonogo/ui-kit";
import {
  installRenderProbe,
  payloadFor,
  type RenderProbeApi,
  type SceneMount,
  sceneFromFixture,
} from "@ksp-gonogo/uplink-tools/render-probe";
import { useEffect, useRef, useState } from "react";

export interface UplinkSceneProps {
  /** The Uplink's client id, as `defineUplinkClient` declares it. */
  uplinkId: string;
  /** The fixture, as its JSON file holds it, `_scene` block included. */
  fixture: Record<string, unknown>;
  /** The fixture's path, for errors that name it. */
  file: string;
  /** One of the modes the scene declares; its first when absent. */
  mode?: string;
  /** Grid units overriding the mode's tile. */
  w?: number;
  h?: number;
  /** Handed the scene's own mount once it has settled, to feed it or read it. */
  onMounted?: (mount: SceneMount) => void;
}

let probe: Promise<RenderProbeApi> | undefined;

function renderProbeApi(): Promise<RenderProbeApi> {
  probe ??= installRenderProbe();
  return probe;
}

/**
 * An Uplink's fixture scene mounted through `@ksp-gonogo/uplink-tools`'
 * render probe, the harness its docs page is drawn with: the same scene model,
 * the same declared topics, the same feed.
 *
 * Each scene is a mount of its own, so any number of them stand side by side
 * on a page. A scene's `_scene.before` presses and motion steps are
 * driver-side and are not replayed here.
 */
export function UplinkScene({
  uplinkId,
  fixture,
  file,
  mode,
  w,
  h,
  onMounted,
}: UplinkSceneProps) {
  const host = useRef<HTMLDivElement>(null);
  const mountedCallback = useRef(onMounted);
  mountedCallback.current = onMounted;
  const [failure, setFailure] = useState<Error | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let live = true;
    let scene: SceneMount | undefined;
    setMounted(false);
    const mount = async () => {
      const api = await renderProbeApi();
      if (!live) return;
      const model = sceneFromFixture(
        file,
        file,
        fixture,
        api.readInventory(uplinkId),
      );
      const chosen = model.modes.find((m) => m.name === mode) ?? model.modes[0];
      const tile =
        w === undefined || h === undefined
          ? chosen
          : { ...chosen, w, h, ...gridToPixels(w, h) };
      const own = api.mountScene(el, payloadFor(model, tile, false));
      scene = own;
      await own.ready;
      if (!live) return;
      setMounted(true);
      mountedCallback.current?.(own);
    };
    // Outside React's commit: the probe creates and unmounts a root of its own.
    queueMicrotask(() => {
      if (!live) return;
      mount().catch(
        (err: unknown) =>
          live &&
          setFailure(err instanceof Error ? err : new Error(String(err))),
      );
    });
    return () => {
      live = false;
      queueMicrotask(() => {
        void scene?.unmount();
      });
    };
  }, [uplinkId, fixture, file, mode, w, h]);

  if (failure) throw failure;
  return <div ref={host} data-scene={mounted ? "mounted" : "mounting"} />;
}
