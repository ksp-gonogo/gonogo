import type { AnyAugment } from "@ksp-gonogo/core";
import { useAugmentAvailable } from "@ksp-gonogo/core";
import { useEffect } from "react";

/**
 * Reports one `map-view.base` augment's live Domain availability, through the
 * same `useAugmentAvailable` gate `<AugmentSlot>` applies. One component per
 * augment so the hook underneath keeps a stable position. Renders nothing.
 */
export function VanillaSuppressionProbe({
  augment,
  onAvailableChange,
}: Readonly<{
  augment: AnyAugment;
  onAvailableChange: (id: string, available: boolean) => void;
}>) {
  const available = useAugmentAvailable(augment);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reports on every value change; onAvailableChange is a stable host callback (useCallback with an empty dep list)
  useEffect(() => {
    onAvailableChange(augment.id, available);
    return () => onAvailableChange(augment.id, false);
  }, [augment.id, available]);
  return null;
}
