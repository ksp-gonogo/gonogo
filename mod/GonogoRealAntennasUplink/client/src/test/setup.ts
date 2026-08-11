import { installDomStubs, PerfBudget, useTelemetry } from "@ksp-gonogo/core";
import { installTestHost } from "@ksp-gonogo/sitrep-sdk/testing";
import { setQuantityLocale } from "@ksp-gonogo/ui-kit";

installDomStubs();

// Soft-cap regression gate: any test that pushes a registered PerfBudget over
// its threshold fails. See PerfBudget.installTestGate for opt-out.
PerfBudget.installTestGate();

// Bridge the sitrep-sdk facade's fail-loud shims to the SAME real core
// singletons this suite exercises: mirrors buildGonogoHost() member-for-member,
// scoped to the subset this client actually calls.
//
// That subset is `useTelemetry` alone, and it is smaller than every sibling
// Uplink's because this client registers no component: there is no
// registerComponent at module load, because RealAntennas ships no widget (see
// index.ts). The hook is still needed, since the hydration test proves the
// relocated unit registrations by DECODING a frame through the real pipeline
// rather than by reading a registry, and that goes through the facade.
installTestHost({
  useTelemetry,
});

// Pin the locale every quantity is written in. It defaults to the READER's
// locale, which is right for an operator and wrong for a snapshot: a render on
// a French machine has to match one on an American CI runner.
setQuantityLocale("en-GB");
