import {
  createFakeWallClock,
  dvCurrentStageResourceChannel,
  dvCurrentStageResourceMaxChannel,
  type FakeWallClock,
  StubTransport,
  spaceCenterStateChannel,
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
  vesselStateChannel,
} from "@ksp-gonogo/sitrep-client";
import type { Meta } from "@ksp-gonogo/sitrep-sdk";
import type { JSX, ReactNode } from "react";

/**
 * The stream test-adapter, minimal version: a migrated widget's test needs
 * to genuinely run OFF THE STREAM (a real `TelemetryProvider` + a real
 * `TelemetryClient`/`TimelineStore` pipeline), not the legacy
 * `MockDataSource` registry. Copied verbatim out of `@ksp-gonogo/components`'s
 * `src/test/setupStreamFixture.tsx` alongside the RoboticsConsole/
 * RotorTachometer/DeployedScience move: fully self-contained (only depends
 * on `@ksp-gonogo/sitrep-client`/`@ksp-gonogo/sitrep-sdk`), so it came along
 * as its own copy rather than a cross-package import.
 *
 * - **`StubTransport`** (not `ReplayTransport`): this adapter is for
 *   hand-authored, per-test wire emissions (`fixture.emit(topic, payload)`),
 *   subscription-gated exactly like production (`StubTransport.emit` only
 *   delivers once something has actually subscribed, proving the widget's
 *   `useStream`/shim ref-count genuinely subscribed, a real correctness
 *   signal). A widget test that wants to replay a full recording instead
 *   should build its own `ReplayTransport` directly.
 * - **`FixedViewClock` pattern**: `new ViewClock({ nowWall: wall.now,
 *   warpRate: () => 1, delaySeconds: () => opts.delaySeconds ?? 0 })`,
 *   pinned via `scrubTo` when `pinnedUt` is supplied, the SDK analog of the
 *   visual-gate's pinned `Date.now()`. `wall` is exposed (via the
 *   now-exported `createFakeWallClock`) for a test that needs to advance it
 *   explicitly.
 * - **`carriedChannels`** is required, not defaulted, a caller must state
 *   which topics (read AND command) this fixture carries; nothing is
 *   silently promoted (mirrors the production allowlist's own "explicit
 *   dev-first promotion" contract, `TelemetryProvider`'s own doc comment).
 * - **`delaySeconds`**: every dual-run/stream test up to this point
 *   hardcoded `delaySeconds: () => 0`: the ONE knob the whole streaming
 *   pipeline exists for was untested. A caller
 *   that supplies a nonzero `delaySeconds` MUST leave `pinnedUt` unset:
 *   `ViewClock.viewUt()`'s `scrubTo` target wins outright over the
 *   confirmed-edge/delay computation (see that method's own doc comment),
 *   so a pinned clock makes `delaySeconds` a no-op. Drive time with
 *   `fixture.wall.advanceBy(seconds)` (+ `fixture.store.beginFrame()` to
 *   apply it: nothing else triggers a frame between ingests) instead.
 */
export interface StreamFixtureOptions {
  /** Topics (read AND command) to promote into the carried-channels allowlist. */
  carriedChannels: Iterable<string>;
  /** UT to pin the view clock at, via `clock.scrubTo`. Omit to leave the clock live (required for `delaySeconds` to have any effect; see this file's doc comment). */
  pinnedUt?: number;
  /** Fixed network/display delay in seconds (`ViewClock`'s delay authority). Defaults to 0, preserving every existing steady-state fixture's behavior untouched. */
  delaySeconds?: number;
}

export interface StreamFixture {
  transport: StubTransport;
  client: TelemetryClient;
  store: TimelineStore;
  wall: FakeWallClock;
  /** Wraps `children` in the `TelemetryProvider` this fixture built. */
  Provider: (props: { children: ReactNode }) => JSX.Element;
  /** `transport.emit`, forwarded for convenience: subscription-gated, same as calling it directly. */
  emit: (
    topic: string,
    payload: unknown,
    metaOverrides?: Partial<Meta>,
  ) => void;
}

export function setupStreamFixture(opts: StreamFixtureOptions): StreamFixture {
  const wall = createFakeWallClock();
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const clock = new ViewClock({
    nowWall: wall.now,
    warpRate: () => 1,
    delaySeconds: () => opts.delaySeconds ?? 0,
  });
  // A carried channel written as a `.`-terminated prefix sentinel (e.g.
  // "fleet." or any per-subject dynamic namespace) is a DYNAMIC whole-topic
  // namespace: tell the
  // store so a 3+-segment dynamic topic (fleet.<guid>.delay) is subscribed/
  // sampled whole, not mis-split into a `<parent>.<field>` the wire never
  // publishes. Exact (non-`.`-terminated) carried topics are unaffected.
  const carriedList = Array.from(opts.carriedChannels);
  const store = new TimelineStore(clock, {
    dynamicWholeTopicPrefixes: carriedList.filter((t) => t.endsWith(".")),
  });
  store.registerDerivedChannel(vesselStateChannel);
  store.registerDerivedChannel(spaceCenterStateChannel);
  // FuelStatus's stage-scoped resource bars (`dv.currentStageResource(Max)`,
  // dv-stage-resources.ts) need these registered too, same story as
  // vesselStateChannel/spaceCenterStateChannel above: every caller of this
  // shared helper (including the probe/visual-gate render harness) gets them
  // for free instead of each widget's own test file registering them by
  // hand (FuelStatus/index.test.tsx used to be the only place that did).
  store.registerDerivedChannel(dvCurrentStageResourceChannel);
  store.registerDerivedChannel(dvCurrentStageResourceMaxChannel);
  if (opts.pinnedUt !== undefined) clock.scrubTo(opts.pinnedUt);

  const carriedChannels = carriedList;

  function Provider({ children }: { children: ReactNode }) {
    return (
      <TelemetryProvider
        client={client}
        store={store}
        carriedChannels={carriedChannels}
      >
        {children}
      </TelemetryProvider>
    );
  }

  return {
    transport,
    client,
    store,
    wall,
    Provider,
    emit: (topic, payload, metaOverrides) =>
      transport.emit(topic, payload, metaOverrides),
  };
}
