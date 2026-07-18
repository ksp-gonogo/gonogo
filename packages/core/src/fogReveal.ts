// Mod-agnostic registry for fog-of-war reveal sources. A reveal source
// contributes DATA (coverage bytes for a body under some layerId), not a
// renderable component — that's why this is a parallel registry to
// augments.ts rather than another AugmentSlot kind. Consumed by MapView's
// own useCoverageGate (packages/components/src/MapView/useCoverageGate.ts)
// as a PAINT-GATE — see that file's header for why this is not a fog
// compositor: there is no fog overlay layer in this design, only surface
// content whose alpha is modulated per-tile by the composite of every
// enabled source here.

import { logger } from "@ksp-gonogo/logger";
import type {
  AugmentSettingField,
  NamespacedAugmentSettings,
} from "./augments";

export interface FogRevealSourceDefinition {
  /** Globally unique. Convention: "<uplinkId>:<name>", e.g. "example-uplink:AltimetryHiRes". */
  id: string;
  label?: string;
  /** Composite weight, 0-255. Undefined means the consumer applies its own default. */
  weight?: number;
  settings?: readonly AugmentSettingField[];
}

const fogRevealSources = new Map<
  string,
  { def: FogRevealSourceDefinition; order: number }
>();
let registrationCounter = 0;

const changeListeners = new Set<() => void>();
function notifyChange(): void {
  for (const cb of changeListeners) cb();
}

export function onFogRevealSourcesChange(cb: () => void): () => void {
  changeListeners.add(cb);
  return () => {
    changeListeners.delete(cb);
  };
}

export function registerFogRevealSource(def: FogRevealSourceDefinition): void {
  logger.info(`REGISTERED fog reveal source ${def.id}`);
  fogRevealSources.set(def.id, { def, order: registrationCounter++ });
  notifyChange();
}

export function unregisterFogRevealSource(id: string): void {
  if (fogRevealSources.delete(id)) notifyChange();
}

export function getFogRevealSources(): FogRevealSourceDefinition[] {
  return Array.from(fogRevealSources.values())
    .sort((a, b) => a.order - b.order)
    .map((entry) => entry.def);
}

export function getFogRevealSourceSettings(): NamespacedAugmentSettings[] {
  return getFogRevealSources()
    .filter((def) => def.settings && def.settings.length > 0)
    .map((def) => ({
      augmentId: def.id,
      namespace: def.id,
      fields: def.settings ?? [],
    }));
}

export function clearFogRevealSources(): void {
  fogRevealSources.clear();
  registrationCounter = 0;
  notifyChange();
}
