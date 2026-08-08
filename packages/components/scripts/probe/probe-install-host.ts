// Installs the injected gonogo host BEFORE the probe imports any facade-sealed
// Uplink client. `probe-entry.tsx` / `screen-entry.tsx` do a side-effect
// `import "@ksp-gonogo/gonogo-kos-uplink"` to self-register the kOS terminal widget, and that
// client calls the facade's `registerComponent` (and, at render, `useCommand` /
// `useStream` / …): all of which resolve through `getHost()` and throw "the
// gonogo host has not been installed" without a host. ES imports are hoisted
// and evaluated in source order, so this module MUST be the FIRST import in
// each probe entry, ahead of the client import.
//
// The bridge mirrors the kOS client's own `test/setup.ts` and the app's
// `buildGonogoHost()` member-for-member, scoped to what the probe's sealed
// widgets call: wiring the sdk facade's fail-loud shims to the SAME real
// core / data / sitrep-client singletons the probe already imports. Its own
// imports carry no facade self-registration, so running it first is safe.
// `AugmentSlot`/`registerAugment`/`useProcessor` were added alongside the
// `@ksp-gonogo/gonogo-kerbalism-uplink` probe import: Ship Systems calls
// `useProcessor` + `AugmentSlot` at render, and its Greenhouse augment calls
// `registerAugment` at module load, same as the Kerbalism client's own
// `test/setup.ts`.
import {
  AugmentSlot,
  defineUplinkClient,
  getDataSource,
  getUplinkHandle,
  PerfBudget,
  registerAugment,
  registerComponent,
  registerDataSource,
  registerUplinkHandle,
} from "@ksp-gonogo/core";
import { useReplaySessionActive } from "@ksp-gonogo/data";
import { logger } from "@ksp-gonogo/logger";
import {
  getActiveTelemetryClient,
  useCommand,
  useLatestValue,
  useProcessor,
  useRouteCommands,
  useStream,
  useStreamEvent,
  useTelemetryClientOptional,
  useUtNow,
} from "@ksp-gonogo/sitrep-client";
import type { GonogoHost } from "@ksp-gonogo/sitrep-sdk";
import { installTestHost } from "@ksp-gonogo/sitrep-sdk/testing";

installTestHost({
  AugmentSlot: AugmentSlot as GonogoHost["AugmentSlot"],
  createPerfBudget: (opts) => new PerfBudget(opts),
  defineUplinkClient,
  getActiveTelemetryClient: getActiveTelemetryClient as Parameters<
    typeof installTestHost
  >[0]["getActiveTelemetryClient"],
  getDataSource,
  getUplinkHandle,
  logger,
  registerAugment: registerAugment as Parameters<
    typeof installTestHost
  >[0]["registerAugment"],
  registerComponent,
  registerDataSource: registerDataSource as Parameters<
    typeof installTestHost
  >[0]["registerDataSource"],
  registerUplinkHandle: registerUplinkHandle as Parameters<
    typeof installTestHost
  >[0]["registerUplinkHandle"],
  useCommand: (command) =>
    useCommand(command) as unknown as ReturnType<GonogoHost["useCommand"]>,
  useLatestValue,
  useProcessor: useProcessor as GonogoHost["useProcessor"],
  useRouteCommands: (topic) =>
    useRouteCommands(topic) as unknown as ReturnType<
      GonogoHost["useRouteCommands"]
    >,
  useReplaySessionActive,
  useStream,
  useStreamEvent,
  useTelemetryClientOptional: useTelemetryClientOptional as Parameters<
    typeof installTestHost
  >[0]["useTelemetryClientOptional"],
  useUtNow,
});
