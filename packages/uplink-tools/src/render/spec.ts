import { readUplinkDeclaration } from "@ksp-gonogo/sitrep-sdk/uplink-manifest";
import type {
  InventoryAugment,
  InventoryContribution,
  InventoryErrorCode,
  InventoryReckonerExemption,
  UplinkInventory,
} from "../render-probe";
import type { UplinkPackage } from "./context";
import type { WidgetRecord } from "./widgetRecord";
import type {
  WireChannel,
  WireCommand,
  WirePayload,
  WireSurface,
} from "./wire";

/**
 * Where `uplink-tools docs` and `uplink-tools page` write an Uplink's spec
 * sheet, relative to its client package. Committed beside the README and
 * checked with it.
 *
 * @category Uplink page
 */
export const SPEC_FILE = "docs/spec.json";

/**
 * The version of the spec sheet's own shape. A reader that finds a number it
 * does not know should not guess at the fields.
 *
 * @category Uplink page
 */
export const SPEC_VERSION = 1;

/**
 * An Uplink described as data: everything its README lists, for a developer or
 * a tool that reads another author's Uplink. It holds only strings, numbers,
 * booleans, lists and objects, so it can be rendered as text with no markup and
 * no code run.
 *
 * Useful for a developer deciding whether an Uplink's Topics, commands and
 * slots fit what they are building. Written by `uplink-tools page` and
 * `uplink-tools docs`.
 *
 * It does not carry the contract and extension API the client was built
 * against: `gonogo-uplink.json` beside it holds those numbers, and the README
 * prints them in its "Built against" row.
 *
 * @category Uplink page
 */
export interface UplinkSpec {
  /** The shape version of this file, {@link SPEC_VERSION}. */
  specVersion: number;
  /** Who the Uplink is. */
  uplink: {
    id: string;
    name: string;
    version: string;
    description: string;
    /** The game mod it wraps, when its `uplink.json` names one. */
    wraps: { name: string; builtAgainst?: string; tier?: string } | null;
  };
  /** The Topics it publishes, each with its delivery and delay when the C# declaration could be read. */
  topics: WireChannel[];
  /** Payload shapes reached through a Topic's fields. */
  nestedPayloads: WirePayload[];
  /** Payload shapes no listed Topic routes to. */
  otherPayloads: WirePayload[];
  /** The commands it accepts. */
  commands: WireCommand[];
  /** The argument shapes those commands take. */
  commandArgs: WirePayload[];
  /** The widgets it registers. */
  widgets: WidgetRecord[];
  /** The slots it fills in other widgets. */
  augments: InventoryAugment[];
  /** The values it contributes to named slots. */
  contributions: InventoryContribution[];
  /** The models it runs. */
  models: {
    processors: string[];
    forwardModels: string[];
    derivedChannels: string[];
    inputRuleExemptions: InventoryReckonerExemption[];
  };
  /** The refusal refinements it answers with. */
  errorCodes: InventoryErrorCode[];
}

function byId<Item extends { id: string }>(items: readonly Item[]): Item[] {
  return [...items].sort((a, b) => a.id.localeCompare(b.id));
}

function byName(items: readonly WirePayload[]): WirePayload[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The Uplink's spec sheet, built from the same inventory and wire surface its
 * README is built from. Every list is ordered by id, so the file is the same
 * on every machine.
 *
 * @category Uplink page
 */
export function buildUplinkSpec(
  pkg: UplinkPackage,
  inventory: UplinkInventory,
  wire: WireSurface,
  widgets: readonly WidgetRecord[],
): UplinkSpec {
  const mod = readUplinkDeclaration(pkg.dir)?.declared.mod;
  return {
    specVersion: SPEC_VERSION,
    uplink: {
      id: inventory.id,
      name: inventory.name,
      version: inventory.version,
      description: (inventory.description ?? "").replace(/\s+/g, " ").trim(),
      wraps: mod?.name
        ? {
            name: mod.name,
            ...(mod.builtAgainst ? { builtAgainst: mod.builtAgainst } : {}),
            ...(mod.tier ? { tier: mod.tier } : {}),
          }
        : null,
    },
    topics: byId(wire.channels),
    nestedPayloads: byName(wire.nested),
    otherPayloads: byName(wire.payloads),
    commands: byId(wire.commands),
    commandArgs: byName(wire.argShapes),
    widgets: byId(widgets),
    augments: byId(inventory.augments),
    contributions: byId(inventory.contributions),
    models: {
      processors: [...inventory.processors].sort(),
      forwardModels: [...inventory.reckonedTopics].sort(),
      derivedChannels: [...inventory.derivedChannels].sort(),
      inputRuleExemptions: [...inventory.reckonerExemptions].sort((a, b) =>
        a.topic.localeCompare(b.topic),
      ),
    },
    errorCodes: byId(inventory.errorCodes ?? []),
  };
}

/**
 * The spec sheet as the file holds it: two-space indented JSON ending in a
 * newline.
 *
 * @category Uplink page
 */
export function uplinkSpecJson(spec: UplinkSpec): string {
  return `${JSON.stringify(spec, null, 2)}\n`;
}
