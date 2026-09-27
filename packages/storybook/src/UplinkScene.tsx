import "./setup";
import { gridToPixels } from "@ksp-gonogo/ui-kit";
import {
  installRenderProbe,
  payloadFor,
  type RenderProbeApi,
  sceneFromFixture,
} from "@ksp-gonogo/uplink-tools/render-probe";
import { useEffect, useState } from "react";

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
}

let probe: Promise<RenderProbeApi> | undefined;

function renderProbeApi(): Promise<RenderProbeApi> {
  probe ??= installRenderProbe();
  return probe;
}

/**
 * An Uplink's fixture scene mounted through `@ksp-gonogo/uplink-tools`'
 * render probe, the harness its docs page is drawn with: the same scene model,
 * the same carried channels, the same feed.
 *
 * The probe mounts into the page's `#root` and holds one scene at a time. A
 * scene's `_scene.before` presses are driver-side and are not replayed here.
 */
export function UplinkScene({
  uplinkId,
  fixture,
  file,
  mode,
  w,
  h,
}: UplinkSceneProps) {
  const [failure, setFailure] = useState<Error | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    let live = true;
    setMounted(false);
    const mount = async () => {
      const api = await renderProbeApi();
      const scene = sceneFromFixture(
        file,
        file,
        fixture,
        api.readInventory(uplinkId),
      );
      const chosen = scene.modes.find((m) => m.name === mode) ?? scene.modes[0];
      const tile =
        w === undefined || h === undefined
          ? chosen
          : { ...chosen, w, h, ...gridToPixels(w, h) };
      await api.renderScene(payloadFor(scene, tile, false));
    };
    // Outside React's commit: the probe unmounts and creates a root of its own.
    queueMicrotask(() => {
      if (!live) return;
      mount().then(
        () => live && setMounted(true),
        (err: unknown) =>
          live &&
          setFailure(err instanceof Error ? err : new Error(String(err))),
      );
    });
    return () => {
      live = false;
      queueMicrotask(() => {
        renderProbeApi().then((api) => api.unmountScene());
      });
    };
  }, [uplinkId, fixture, file, mode, w, h]);

  if (failure) throw failure;
  return <div id="root" data-scene={mounted ? "mounted" : "mounting"} />;
}
