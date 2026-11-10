import type { ComponentType, ReactNode } from "react";
import type { UplinkClientIdentity } from "./types";

/**
 * What a {@link PartPanelDefinition}'s component is given: the part it was
 * opened for and the way to close it. Useful for drawing a control for one part
 * of the vessel in place of a window the game would open on its own screen.
 *
 * @category Part panels
 */
export interface PartPanelProps {
  /** The part's `flightId`, as a decimal string. */
  partId: string;
  /** The part's display title. */
  partTitle: string;
  /** Closes the panel. */
  close: () => void;
}

/**
 * A game button a {@link PartPanelDefinition} opens in place of, named as the
 * part's own action list names it. Useful for sending a button that opens a
 * window on the game's screen to a panel the operator can use from the console.
 *
 * @category Part panels
 */
export interface PartPanelGameButton {
  /** The `PartModule` that owns the button (`PartActionEntry.moduleName`), or `null` for a button on the part itself. */
  module: string | null;
  /** The button's event name (`PartActionEntry.name`). */
  event: string;
}

/**
 * A panel that opens as a dialog over the dashboard, for one part of the active
 * vessel, from that part's menu on the Vessel Schematic. Useful for giving the
 * operator a console version of a control the game offers only in a window of
 * its own. Pass it to the `registerPartPanel` method of an Uplink's handle.
 *
 * The panel is mounted inside the widget that opened it, so it reads telemetry
 * and sends commands as that widget does, and every command it sends waits on
 * the signal delay as any other. Opening it sends nothing. It closes when its
 * part leaves the vessel.
 *
 * @category Part panels
 * @categoryDescription Part panels
 * Dialogs opened from a part's menu on the Vessel Schematic. A panel reaches
 * the menu by naming a game button in `replaces`.
 */
export interface PartPanelDefinition {
  /** Unique among panels. The `registerPartPanel` method of an Uplink's handle prefixes it with the Uplink's id. */
  id: string;
  /** The dialog's heading, which is drawn before the part's title. */
  title: string;
  /** Drawn beside the dialog's heading, outside the name the heading gives the dialog. A control or icon here needs its own accessible name. */
  titleAdornment?: ReactNode;
  /** Draws the panel's content. */
  component: ComponentType<PartPanelProps>;
  /**
   * The game buttons this panel opens in place of. The button keeps the game's
   * label, group and disabled state. The first panel registered for a button is
   * the one it opens.
   */
  replaces?: readonly PartPanelGameButton[];
  /** The Domain the panel needs. While it is absent, a button in `replaces` behaves as it would with no panel. */
  requires?: string;
  /** CSS length for the dialog's max-width. Defaults to the dialog's own default. */
  width?: string;
  /** The Uplink the panel belongs to. Set by the handle's `registerPartPanel`. */
  owner?: UplinkClientIdentity;
}

/**
 * A game button as a {@link PartPanelFallback} is asked about it: where it
 * comes from and what the part's action list calls it.
 *
 * @category Part panels
 */
export interface PartPanelFallbackButton extends PartPanelGameButton {
  /** The button's label, as the part's action list gives it. */
  label: string;
}

/**
 * Decides whether a game button that no panel names in `replaces` opens a panel
 * anyway, and returns that panel, or `undefined` to leave the button as it is.
 * Useful for a general console version of whole families of game windows. Pass
 * it to {@link registerPartPanelFallback}. It is called each time a part's menu
 * draws, so it must be free of side effects. A panel named in `replaces` always
 * takes precedence.
 *
 * @category Part panels
 */
export type PartPanelFallback = (
  button: PartPanelFallbackButton,
) => PartPanelDefinition | undefined;

/* One global slot rather than module statics, so a second loaded copy of this package finds the same registry. */
const PART_PANELS_KEY = "__GONOGO_PART_PANELS__" as const;

interface PartPanelState {
  panels: Map<string, PartPanelDefinition>;
  fallbacks: readonly PartPanelFallback[];
  listeners: Set<() => void>;
  /* Rebuilt on every change, so the list stays referentially stable between changes for `useSyncExternalStore`. */
  snapshot: readonly PartPanelDefinition[];
}

function state(): PartPanelState {
  const slot = globalThis as typeof globalThis & {
    [PART_PANELS_KEY]?: PartPanelState;
  };
  slot[PART_PANELS_KEY] ??= {
    panels: new Map(),
    fallbacks: [],
    listeners: new Set(),
    snapshot: [],
  };
  return slot[PART_PANELS_KEY];
}

function changed(s: PartPanelState): void {
  s.snapshot = Array.from(s.panels.values());
  for (const listener of s.listeners) listener();
}

/**
 * Adds a panel the Vessel Schematic can open for one part. Useful for offering
 * the operator a console version of a game window. Used by the built-in Review
 * Data and Rename Vessel dialogs and by an antenna targeting dialog. Uses the
 * id as written; an Uplink calls the `registerPartPanel` method of its handle,
 * which prefixes the id with the Uplink's own. Returns the id.
 *
 * Registering an id again with the same title replaces the earlier panel. A
 * different title throws.
 *
 * @category Part panels
 */
export function registerPartPanel(def: PartPanelDefinition): string {
  const s = state();
  const existing = s.panels.get(def.id);
  if (existing && existing.title !== def.title) {
    throw new Error(
      `Part panel id "${def.id}" is already registered as "${existing.title}"; cannot register it as "${def.title}".`,
    );
  }
  s.panels.set(def.id, def);
  changed(s);
  return def.id;
}

/**
 * Adds a {@link PartPanelFallback} to the part menus on the Vessel Schematic,
 * asked about each game button no panel names in `replaces`. Useful for
 * offering the operator a console version of game windows no panel covers. The
 * earliest fallback to return a panel wins. Returns the function that removes
 * it.
 *
 * @category Part panels
 */
export function registerPartPanelFallback(
  fallback: PartPanelFallback,
): () => void {
  const s = state();
  s.fallbacks = [...s.fallbacks, fallback];
  changed(s);
  return () => {
    const current = state();
    current.fallbacks = current.fallbacks.filter((f) => f !== fallback);
    changed(current);
  };
}

/**
 * Every registered {@link PartPanelFallback}, earliest first. Useful for
 * resolving a game button the way a part's menu does. The list is the same
 * object until a fallback is added or removed.
 *
 * @category Part panels
 */
export function getPartPanelFallbacks(): readonly PartPanelFallback[] {
  return state().fallbacks;
}

/**
 * Every registered part panel, in registration order. Useful for checking in a
 * test what an Uplink registered with `registerPartPanel`. The list is the same
 * object until a panel is registered or the registry is cleared.
 *
 * @category Part panels
 */
export function getPartPanels(): readonly PartPanelDefinition[] {
  return state().snapshot;
}

/**
 * Calls `cb` whenever a part panel is registered or the registry is cleared.
 * Returns the function that stops it. Useful for redrawing a part's menu when
 * the panels it can open change.
 *
 * @category Part panels
 */
export function onPartPanelsChange(cb: () => void): () => void {
  const { listeners } = state();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Removes every registered part panel, so a test starts with none.
 *
 * @category Part panels
 */
export function clearPartPanels(): void {
  const s = state();
  s.panels.clear();
  s.fallbacks = [];
  changed(s);
}
