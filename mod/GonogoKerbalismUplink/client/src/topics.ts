// KerbalismUplink client-owned bare-primitive Topic registration.
//
// `kerbalism.available` is a bare JSON boolean the KerbalismUplink emits
// (DelayRole.TrueNow) as the Domain presence gate: like the other Uplinks'
// bare `<domain>.available`, it has no [SitrepTopic] payload POCO, so it never
// flows through codegen.
// The Uplink client declares it here (type half) + registers it at module load
// (runtime half) so `useTelemetry("kerbalism.available")` is typed and the
// app-side C#↔registry sync check sees it.
//
// The structured Kerbalism Topics (kerbalism.spaceweather / .lifesupport /
// .crew / .features) DO have contract POCOs, so they arrive via the generated
// SDK and need no declaration here.
import { registerBarePrimitiveTopic } from "@ksp-gonogo/sitrep-sdk";

declare module "@ksp-gonogo/sitrep-sdk" {
  interface TopicPayloadMap {
    "kerbalism.available": boolean;
  }
}

registerBarePrimitiveTopic("kerbalism.available");
