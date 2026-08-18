import {
  installDomStubs,
  installRealTestHost,
  PerfBudget,
} from "@ksp-gonogo/sitrep-testing";
import { setQuantityLocale } from "@ksp-gonogo/ui-kit";

installDomStubs();

// Soft-cap regression gate: any test that pushes a registered PerfBudget over
// its threshold fails. See PerfBudget.installTestGate for opt-out.
PerfBudget.installTestGate();

// Bridge the sitrep-sdk facade's fail-loud shims to the real singletons this
// suite exercises. Every member, not the subset this client happens to call
// today: a test gains nothing from the host lacking members, and a partial one
// fails as `getHost().<member> is not a function` the first time a widget is
// re-pointed at the facade.
installRealTestHost();

// Pin the locale every quantity is written in. It defaults to the READER's
// locale, which is right for an operator and wrong for a snapshot: a render on
// a French machine has to match one on an American CI runner.
setQuantityLocale("en-GB");
