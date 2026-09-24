// Installs the injected gonogo host BEFORE a probe entry registers anything
// through the sdk facade. The planted Uplink (`plantedUplink.ts`) calls
// `defineUplinkClient` and, at render, `useCommand` / `useStream` / ..., all of
// which resolve through `getHost()` and throw "the gonogo host has not been
// installed" without a host. ES imports are hoisted and evaluated in source
// order, so this module MUST be the FIRST import in each probe entry.
//
// The bridge wires those fail-loud shims to the SAME real core / data /
// sitrep-client singletons the probe already imports, scoped to what a
// probe-rendered registration calls. Its own imports carry no facade
// self-registration, so running it first is safe.
//
// Only members `GonogoHost` declares belong here. The sdk's registries
// (`registerComponent`, `registerDataSource`, the Uplink handles) keep their
// own globalThis-keyed state and never read the host, so passing those through
// wires nothing.
import {
  AugmentSlot,
  defineUplinkClient,
  PerfBudget,
  registerAugment,
  useTelemetry,
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
  logger,
  registerAugment: registerAugment as Parameters<
    typeof installTestHost
  >[0]["registerAugment"],
  useCommand: ((command: string, options?: { vantage?: string }) =>
    useCommand(command, options)) as GonogoHost["useCommand"],
  useLatestValue,
  useProcessor: useProcessor as GonogoHost["useProcessor"],
  useRouteCommands: (topic) =>
    useRouteCommands(topic) as unknown as ReturnType<
      GonogoHost["useRouteCommands"]
    >,
  useReplaySessionActive,
  useStream,
  useStreamEvent,
  // Overloaded on the sdk side (canonical one-arg Topic read, and the
  // retired useDataValue's legacy two-arg flat-key read carried
  // over onto this same name: see GonogoHost.useTelemetry's doc). Mirrors
  // the app's own `buildGonogoHost()` wiring (packages/app/src/uplinks/
  // host.ts) member-for-member: real core `useTelemetry` already branches
  // internally on whether `key` is present while keeping every hook call
  // unconditional, so this is a single, unconditional forward of both args.
  useTelemetry: ((dataSourceIdOrTopic: string, key?: string) =>
    (useTelemetry as (a: string, b?: string) => unknown)(
      dataSourceIdOrTopic,
      key,
    )) as GonogoHost["useTelemetry"],
  useTelemetryClientOptional: useTelemetryClientOptional as Parameters<
    typeof installTestHost
  >[0]["useTelemetryClientOptional"],
  useUtNow,
});
