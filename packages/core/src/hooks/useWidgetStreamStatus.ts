import {
  mapTopic,
  type StreamStatusValue,
  useTelemetryStoreOptional,
  worstStatus,
} from "@ksp-gonogo/sitrep-client";
import {
  formatStreamStatus,
  severityFromStreamStatus,
  useStatusContribution,
  type WidgetTopicDeclaration,
  widgetDeclaredTopics,
} from "@ksp-gonogo/ui-kit";
import { useCallback, useMemo, useSyncExternalStore } from "react";

/**
 * The grades a whole WIDGET can honestly be badged with, as opposed to the
 * ones that belong to one channel.
 *
 * `Panel`'s own comment refuses a host-derived worst-of across a widget's
 * channels, and is right about the grades it is refusing: `absent` means
 * opposite things per topic (an empty `vessel.maneuvers` is normal, an absent
 * `vessel.orbit` is not), and a `held-stale` heartbeat miss is one producer's.
 * One pill for five topics could not say which, so the pill would be a
 * lossy summary that reads as a fault when there is none.
 *
 * These two are not that. Both are stamped by the SUBJECT's blackout
 * authority, which is per craft and not per topic:
 * `ChannelEngine.SetSubjectConnected` marks the whole node down, and
 * `Courier.ReplayRecorded` stamps every sample of the reacquisition dump on
 * every topic it covers. So "one of this widget's channels is recorded" and
 * "this craft was out of contact" are the same claim, and restating it on the
 * panel loses nothing.
 *
 * That is the whole reason this can be automatic where the rest cannot.
 */
const WIDGET_WIDE_GRADES: ReadonlySet<StreamStatusValue> =
  new Set<StreamStatusValue>(["recorded", "last-before-blackout"]);

/**
 * The blackout grade covering a widget's declared channels, or `null` when
 * none of them is behind an outage.
 *
 * Named in three doc comments before it existed (`Panel`'s `panelStatus`
 * telling widgets to leave the prop unset because "the panel reads the status
 * the host derived", `StreamStatusBadge`'s "most widgets should not render this
 * by hand", and `widgetDeclaredTopics`'s "the stream-status badge derived from
 * this would go quiet"). Nothing derived one, and nothing passed `panelStatus`
 * either, so `recorded` had exactly one render site in the tree: a feature the
 * whole recorder chain exists to surface, invisible in the product.
 *
 * Reads without SUBSCRIBING. A widget's own hooks subscribe to what it reads;
 * this only asks the store what it already holds, once per frame. Subscribing
 * here would put real traffic on the wire for every topic a widget merely
 * DECLARES, and it would buy nothing: an unsubscribed topic reads `resyncing`,
 * which is not a blackout grade and contributes nothing.
 */
export function useWidgetStreamStatus(
  def: WidgetTopicDeclaration | undefined,
): StreamStatusValue | null {
  const store = useTelemetryStoreOptional();
  const topics = useMemo(() => {
    /*
     * Same resolution `alarmMatchesWidget` uses, and for the same reason: a
     * widget part-way through the migration declares some channels in the
     * typed vocabulary and keeps the rest as legacy keys.
     */
    return widgetDeclaredTopics(def).map(
      (requirement) => mapTopic("data", requirement) ?? requirement,
    );
  }, [def]);

  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      store ? store.subscribeFrame(onStoreChange) : () => {},
    [store],
  );

  const getSnapshot = useCallback((): StreamStatusValue | null => {
    if (!store || topics.length === 0) return null;
    const frame = store.currentFrame();
    const grades = topics
      .map((topic) => store.sampleStatus(topic, frame))
      .filter((status) => WIDGET_WIDE_GRADES.has(status));
    if (grades.length === 0) return null;
    return worstStatus(grades);
  }, [store, topics]);

  return useSyncExternalStore(subscribe, getSnapshot);
}

/**
 * Folds a widget's blackout grade into the per-item `PanelStatusStore`, so the
 * `Panel` that widget renders shows the pill with the widget wiring nothing.
 *
 * A sibling of `AlarmStatusBridge` in every respect: rendered once per grid
 * item, inside that item's store, drawing nothing itself. It contributes under
 * its own id rather than Panel's `"stream"`, so a widget that DOES pass
 * `panelStatus` (a sub-panel reading one specific topic) keeps its own reading
 * and the two merge worst-first, which is what the summary is for.
 */
export function WidgetStreamStatusBridge({
  def,
}: {
  def: WidgetTopicDeclaration | undefined;
}) {
  const status = useWidgetStreamStatus(def);
  useStatusContribution(
    status !== null
      ? {
          id: "stream:blackout",
          severity: severityFromStreamStatus(status),
          label: formatStreamStatus(status) ?? "",
        }
      : null,
  );
  return null;
}
