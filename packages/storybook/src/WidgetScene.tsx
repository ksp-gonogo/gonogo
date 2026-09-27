import "./setup";
import { useEffect, useRef, useState } from "react";
import {
  type ProbeSize,
  probePayload,
} from "../../components/scripts/probe/payload";
import {
  renderProbe,
  unmountProbe,
} from "../../components/scripts/probe/probe-entry";
import { withholdExtensions } from "./extensions";

export interface WidgetSceneProps {
  /** Registered widget id. */
  widgetId: string;
  /** The fixture scene, as its JSON file holds it. */
  fixture: Record<string, unknown>;
  /** Grid units, clamped by the probe to the widget's own minSize. */
  w: number;
  h: number;
  /** A render mode's config overlay, clicks and hovers. */
  mode?: Omit<ProbeSize, "w" | "h">;
  /** An install profile the scene declares, by id. */
  profile?: string;
  /** Augment or contribution ids taken out of their registries for this mount. */
  withhold?: readonly string[];
}

/**
 * A registered widget mounted on its fixture through the render harness's own
 * `renderProbe`, so the story is the widget the harness photographs, live.
 *
 * The probe keeps one mounted scene per page: a second `WidgetScene` on the same
 * page replaces the first.
 */
export function WidgetScene(props: WidgetSceneProps) {
  const host = useRef<HTMLDivElement>(null);
  const [failure, setFailure] = useState<Error | null>(null);
  const [mounted, setMounted] = useState(false);
  const { widgetId, fixture, w, h, mode, profile } = props;
  const withheld = (props.withhold ?? []).join(" ");

  useEffect(() => {
    const root = host.current;
    if (!root) return;
    let live = true;
    let restore = () => {};
    setMounted(false);
    // Outside React's commit: the probe unmounts and creates a root of its own.
    queueMicrotask(() => {
      if (!live) return;
      restore = withholdExtensions(withheld.split(" ").filter(Boolean));
      renderProbe(
        root,
        probePayload({
          widgetId,
          fixture,
          size: { ...mode, w, h },
          profile,
          asDashboard: true,
        }),
      ).then(
        () => live && setMounted(true),
        (err: unknown) =>
          live &&
          setFailure(err instanceof Error ? err : new Error(String(err))),
      );
    });
    return () => {
      live = false;
      queueMicrotask(() => {
        unmountProbe();
        restore();
      });
    };
  }, [widgetId, fixture, w, h, mode, profile, withheld]);

  if (failure) throw failure;
  return <div ref={host} data-scene={mounted ? "mounted" : "mounting"} />;
}
