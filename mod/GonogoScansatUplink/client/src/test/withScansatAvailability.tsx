import type { TopicId } from "@ksp-gonogo/sitrep-sdk";
import { hasAnswered, useTelemetry } from "@ksp-gonogo/sitrep-sdk";
import {
  DomainAvailabilityProvider,
  useDomainAvailabilityStore,
} from "@ksp-gonogo/ui-kit";
import { type ReactNode, useEffect } from "react";

// AugmentSlot's presence gate reads ui-kit's DomainAvailability store, not the
// stream directly. The app mounts an AugmentAvailabilityFeeder that bridges
// `<domain>.available` telemetry into that store; this test-local feeder mirrors
// it for `scansat` so a suite still exercises "the domain announces on the
// stream, then the augment mounts and subscribes" end to end. Same pattern a
// sibling Uplink's docking-camera slot test uses.
function ScansatAvailabilityFeeder() {
  const store = useDomainAvailabilityStore();
  const reading = useTelemetry("scansat.available" as TopicId);
  useEffect(() => {
    // A presence gate asks "has the domain ever reported?", which is now the
    // `pending` arm rather than `undefined`: a `Reading` is never undefined, so the
    // old test announced the domain as available before anything had arrived and
    // the "does not mount until announced" cases could not fail.
    store?.setAvailable("scansat", hasAnswered(reading));
  }, [store, reading]);
  return null;
}

// Must sit inside a `<TelemetryProvider>` (so `useTelemetry` resolves) and
// wrap the gated `<AugmentSlot>` (so it can write the store before the slot's
// gate reads it).
export function WithScansatAvailability({ children }: { children: ReactNode }) {
  return (
    <DomainAvailabilityProvider>
      <ScansatAvailabilityFeeder />
      {children}
    </DomainAvailabilityProvider>
  );
}
