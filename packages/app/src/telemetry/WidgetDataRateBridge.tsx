import type { ComponentDefinition } from "@ksp-gonogo/core";
import { useTelemetryClientOptional } from "@ksp-gonogo/sitrep-client";
import { splitRawFieldSubtopic } from "@ksp-gonogo/sitrep-sdk";
import { useEffect, useMemo } from "react";

/** The Topics a widget asks to have at the fast tier, from its own declaration and its tile's settings, each once and sorted. */
export function fastTopicsOf(
  def: Pick<ComponentDefinition, "dataRates" | "dataRatesFromConfig">,
  config: Record<string, unknown>,
): string[] {
  const values = [
    ...(def.dataRates?.fast ?? []),
    ...(def.dataRatesFromConfig?.(config).fast ?? []),
  ];
  const topics = new Set(
    values.map((value) => splitRawFieldSubtopic(value)?.rawTopic ?? value),
  );
  return [...topics].sort();
}

/**
 * Holds the widget's declared faster rates on the screen's telemetry client
 * while the tile is mounted, so the mod sends those Topics at the fast tier
 * while the widget is open here or on any station. Renders nothing.
 */
export function WidgetDataRateBridge({
  def,
  config,
}: {
  def: ComponentDefinition;
  config: Record<string, unknown>;
}) {
  const client = useTelemetryClientOptional();
  const fast = fastTopicsOf(def, config);
  const key = fast.join("\n");
  const topics = useMemo(() => (key === "" ? [] : key.split("\n")), [key]);

  useEffect(() => {
    if (!client || topics.length === 0) return;
    const releases = topics.map((topic) => client.requestRate(topic, "fast"));
    return () => {
      for (const release of releases) release();
    };
  }, [client, topics]);

  return null;
}
