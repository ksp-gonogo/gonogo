import { useCallback, useEffect, useMemo, useState } from "react";
import type { SystemEntity } from "./systemEntities";

/**
 * Which contributed entity is selected: activating it toggles, Escape clears.
 * Keyed by the activated entity's own id, which the layer reports and
 * `decorate` matches.
 */
export function useEntitySelection<Entity extends SystemEntity>(
  entities: readonly Entity[],
) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const activate = useCallback((id: string) => {
    setSelectedId((prev) => (prev === id ? null : id));
  }, []);
  const deselect = useCallback(() => setSelectedId(null), []);
  // Document-level, and live only while something is selected, since the diagram container has no interactive role.
  useEffect(() => {
    if (selectedId === null) return;
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") deselect();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selectedId, deselect]);
  const selectedEntity = useMemo(
    () => entities.find((e) => e.id === selectedId) ?? null,
    [entities, selectedId],
  );
  return { selectedId, selectedEntity, activate };
}
