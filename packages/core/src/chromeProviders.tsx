import type { ComponentType, ReactNode } from "react";

/**
 * Registry letting generic dashboard chrome (ComponentOverlay, WidgetGearMenu)
 * obtain a context Provider from a registered Uplink without importing it by
 * name. See the module-level design note in the kos migration plan
 * (2026-07-18) for why this exists and the Rules of Hooks constraint it relies
 * on.
 */
export interface ChromeProviderDefinition<T = unknown> {
  /** Stable id. */
  id: string;
  /** Called during the NORMAL render tree — i.e. wherever the value this
   *  provider re-supplies is already ambiently available (e.g. inside
   *  MainScreen's <CpuRegistryProvider> subtree). Must be an actual hook
   *  call site — see useChromeWrap's safety note below. */
  useValue(): T;
  /** Re-wraps `children` with the captured value, for rendering somewhere
   *  the ambient context from useValue()'s call site won't reach. */
  Provider: ComponentType<{ value: T; children: ReactNode }>;
}

const providers = new Map<string, ChromeProviderDefinition>();

export function registerChromeProvider<T>(
  def: ChromeProviderDefinition<T>,
): void {
  providers.set(def.id, def as ChromeProviderDefinition);
}

export function getChromeProviders(): ChromeProviderDefinition[] {
  return [...providers.values()];
}

/** For use in tests only — resets the registry to empty. */
export function clearChromeProviders(): void {
  providers.clear();
}

export function useChromeWrap(): (children: ReactNode) => ReactNode {
  const defs = getChromeProviders();
  // Registration happens at module-load time, before any component using
  // this hook ever mounts (self-registration import side effects, same
  // as every other registry in this codebase). The list's length/order is
  // therefore frozen for the lifetime of any given mount of the calling
  // component — the actual invariant Rules of Hooks protects (consistent
  // call order/count across renders of THIS component instance), even
  // though the call isn't textually a top-level hook call. Tests must
  // call clearChromeProviders() + re-register BEFORE render(), never
  // mid-test, to preserve this.
  // biome-ignore lint/correctness/useHookAtTopLevel: registration is frozen at module-load time (see the comment above), so this list is stable across renders of a given mount — the actual invariant Rules of Hooks protects.
  const values = defs.map((d) => d.useValue());
  return (children: ReactNode) =>
    defs.reduceRight(
      (acc, def, i) => (
        <def.Provider key={def.id} value={values[i]}>
          {acc}
        </def.Provider>
      ),
      children,
    );
}
