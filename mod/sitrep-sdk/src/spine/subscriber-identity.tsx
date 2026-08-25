import { createContext, type ReactNode, useContext } from "react";

/**
 * Which widget the telemetry reads under here belong to.
 *
 * It exists for one purpose: an author whose widget renders blank because it
 * subscribed to a topic nothing publishes gets a log line naming both halves,
 * the topic AND the widget that asked for it. The topic alone is half an answer
 * on a dashboard where thirty widgets are mounted.
 *
 * ui-kit already carries the same identity in `WidgetMetaContext`, and this is
 * deliberately NOT that: ui-kit depends on this package, so the dependency
 * cannot run the other way. Both are mounted from the same two places (the
 * dashboard's `GridItemContent` and ui-kit's `WidgetHostFor`) from the same
 * `ComponentDefinition.id`, so they cannot drift without someone editing one
 * and not the other in a file where they sit adjacent.
 *
 * Absent outside a widget, which is the ordinary case for a bare hook in a
 * test, and then the diagnostic simply names the topic.
 */
const SubscriberLabelContext = createContext<string | undefined>(undefined);

/**
 * Name the widget that the telemetry reads inside `children` belong to. Mount
 * beside `WidgetMetaContext`, with the same `ComponentDefinition.id`.
 */
export function TelemetrySubscriberLabel({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <SubscriberLabelContext.Provider value={label}>
      {children}
    </SubscriberLabelContext.Provider>
  );
}

/** The mounting widget's id, or `undefined` outside one. */
export function useTelemetrySubscriberLabel(): string | undefined {
  return useContext(SubscriberLabelContext);
}
