import { type ComponentDefinition, delayLaneOf } from "@ksp-gonogo/sitrep-sdk";
import type { WidgetRecord } from "./widgetRecord";

/*
 * Kept apart from widgetRecord.ts because it loads the sdk at runtime, which
 * only resolves inside a client with its dependencies installed. The bin loads
 * widgetRecord.ts before it has checked its flags, so that file stays type-only.
 */

/*
 * The dashboard shows a widget's notice when a Topic it requires says there is
 * no vessel, or no career, so the need follows from those Topics: a Topic in
 * the craft's delayed lane needs a vessel, and a widget that requires only
 * career Topics needs a career.
 */
function needsOf(channels: readonly string[]): string[] {
  const needs: string[] = [];
  if (channels.some((t) => delayLaneOf(t) === "delayed")) needs.push("flight");
  if (channels.length > 0 && channels.every((t) => t.startsWith("career."))) {
    needs.push("career");
  }
  return needs;
}

/**
 * The {@link WidgetRecord} of one registered widget. Useful for keeping the
 * README, the widget records file and the render harness in agreement on every
 * field. Used by the render probe when it reads the inventory.
 */
export function widgetRecordOf(def: ComponentDefinition): WidgetRecord {
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    tags: [...def.tags],
    channels: [...(def.channels ?? [])],
    optionalChannels: [...(def.optionalChannels ?? [])],
    commands: [...(def.commands ?? [])],
    channelFamilies: [...(def.channelFamilies ?? [])],
    optionalChannelFamilies: [...(def.optionalChannelFamilies ?? [])],
    readsFromConfig: def.channelsFromConfig !== undefined,
    dataRequirements: (def.dataRequirements ?? []).map((r) => String(r)),
    fields: [...(def.fields ?? [])].map((f) => String(f)),
    actions: (def.actions ?? []).map((a) => ({
      id: a.id,
      label: a.label,
      description: a.description ?? null,
    })),
    augmentSlots: [...(def.augmentSlots ?? [])],
    contributionSlots: [...(def.contributionSlots ?? [])],
    requires: needsOf([
      ...(def.channels ?? []),
      // A field path names its Topic by its first two segments, as the dashboard's gate reads it.
      ...(def.dataRequirements ?? []).map((r) =>
        String(r).split(".").slice(0, 2).join("."),
      ),
    ]),
    replaces: def.replaces ?? null,
    pushable: def.pushable === true,
    defaultSize: def.defaultSize
      ? { w: def.defaultSize.w, h: def.defaultSize.h }
      : null,
    minSize: def.minSize ? { w: def.minSize.w, h: def.minSize.h } : null,
    tiny: def.tiny !== undefined,
  };
}
