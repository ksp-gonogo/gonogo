/**
 * The DOM-snapshot support this package's widgets need: the volatile-attribute
 * strip, a ResizeObserver that reports a real box, and the `_stream`-block
 * replay a fixture's declared wire is fed through.
 *
 * All of it came out of `@ksp-gonogo/components`'s
 * `src/test/widgetDomSnapshot.tsx` with the kOS Terminal probe fixtures, minus
 * everything that serves the legacy `MockDataSource` fixtures this package has
 * none of. The emit shape is that file's `{ channel, value }`, kept so the two
 * moved fixtures came across byte-for-byte.
 */
import { act, type StreamFixture } from "@ksp-gonogo/sitrep-sdk/testing";

/**
 * A fixture's own declaration of what it puts on the wire, and the only
 * authority for what a snapshot shows.
 */
export interface StreamFixtureBlock {
  /** Topics this fixture carries, forwarded to `setupStreamFixture`. */
  carriedChannels: string[];
  /** UT to pin the view clock at. */
  pinnedUt?: number;
  /** Fixed network/display delay in seconds. */
  delaySeconds?: number;
  /** Replayed in order, one `StubTransport.emit` per entry, post-mount. */
  emits: Array<{ channel: string; value: unknown }>;
}

/** Extracts and narrows the `_stream` block off a fixture. */
export function resolveStreamBlock(
  fixture: Record<string, unknown>,
): StreamFixtureBlock | undefined {
  const raw = fixture._stream as StreamFixtureBlock | undefined;
  if (!raw || typeof raw !== "object") return undefined;
  return Array.isArray(raw.emits) ? raw : undefined;
}

/**
 * Replay a fixture's declared emits in order, flushing a provider frame either
 * side of each one.
 *
 * `StubTransport.emit` silently DROPS a sample for a topic nothing has
 * subscribed to yet, and the later emits in a kOS Terminal fixture are exactly
 * that case: the widget only subscribes to `kos.terminal.<coreId>` once a CPU
 * has resolved off `kos.processors`, which takes a frame, and it reads
 * `comms.delay` / `comms.link` from inside the same subtree.
 *
 * `transport.isSubscribed` cannot be used to wait for that. It answers for the
 * CARRIED set the fixture declares, not for a live subscriber, so it reads true
 * from the moment the Provider mounts and a poll on it returns instantly. That
 * is not a hypothetical: polling it dropped three of this fixture's four emits,
 * and the widget rendered a terminal with no text, no delay badge and no
 * no-path warning while every topic reported subscribed. The frame flush is
 * what actually waits.
 */
export async function replayStreamBlock(
  stream: StreamFixture,
  block: StreamFixtureBlock,
): Promise<void> {
  for (const e of block.emits) {
    await flushProviderFrame();
    act(() => {
      stream.emit(e.channel, e.value);
    });
    await flushProviderFrame();
  }
}

/**
 * Grid-unit to pixel conversion, the same arithmetic the components package's
 * render harness sizes its iframe with, so a mode means the same shape in both.
 */
const COL_WIDTH = 32;
const ROW_HEIGHT = 25;
const GRID_MARGIN = 8;

export function modePixels(mode: { w: number; h: number }): {
  w: number;
  h: number;
} {
  return {
    w: mode.w * COL_WIDTH + (mode.w - 1) * GRID_MARGIN,
    h: mode.h * ROW_HEIGHT + (mode.h - 1) * GRID_MARGIN,
  };
}

/**
 * Install a `ResizeObserver` that actually reports a size, for the length of
 * one render, and return the restore.
 *
 * The shared jsdom shim is a no-op in all three methods: it exists to stop a
 * mount crashing and never calls its callback, so any widget gating content on
 * a measured box renders that content NEVER under a snapshot harness. The
 * reported box is the mode's own pixel size rather than a constant, so the
 * modes stay distinguishable and a size-gated branch is exercised at the size
 * it is gated on.
 */
export function installSizedResizeObserver(size: {
  w: number;
  h: number;
}): () => void {
  const previous = globalThis.ResizeObserver;
  class SizedResizeObserver {
    private readonly callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element): void {
      // Asynchronous, like the real one: a synchronous callback would run
      // inside the observing effect and set state during render.
      setTimeout(() => {
        this.callback(
          [
            {
              target,
              contentRect: {
                width: size.w,
                height: size.h,
                x: 0,
                y: 0,
                top: 0,
                left: 0,
                right: size.w,
                bottom: size.h,
              } as DOMRectReadOnly,
            } as ResizeObserverEntry,
          ],
          this as unknown as ResizeObserver,
        );
      }, 0);
    }
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver =
    SizedResizeObserver as unknown as typeof ResizeObserver;
  return () => {
    globalThis.ResizeObserver = previous;
  };
}

/**
 * Let the sized-observer callbacks above land and the resulting re-render
 * commit. Two macrotask turns: the first drains the `setTimeout(0)` queue, the
 * second covers an observer a re-render only then attached.
 */
export async function flushResizeObservers(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * Flush two rAF ticks so the provider's ingest -> beginFrame() applies the
 * emitted values to React state before the DOM is read. `useViewUt`'s scrubbed
 * value only lands via `ViewClock.onFrame`'s rAF loop, and the provider's own
 * ingest is scheduled the same way, so a plain `render()` + `act()` can commit
 * before either has reached React state.
 */
export async function flushProviderFrame(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
}

/**
 * Strip styled-components hashes, testing-library auto-ids, and any `sc-*`
 * class or id attribute that changes per build. Without this the snapshot
 * churns on every styled-components release and file edit.
 *
 * Also strips xterm's PLATFORM class. `xterm-scrollable-element` picks up a
 * trailing `mac` / `windows` / `linux` token from the host it renders on, so a
 * snapshot taken here recorded `mac` and CI, on Linux, produced the same DOM
 * without it: fourteen renders red on a difference that is not about this
 * widget at all. A snapshot that can only pass on the OS that wrote it is worse
 * than none, because it fails for everyone else and says nothing about the code.
 */
export function stripVolatile(html: string): string {
  return html
    .replace(/\sclass="[^"]*\bsc-[^"]*"/g, "")
    .replace(/\sid="[^"]*\bsc-[^"]*"/g, "")
    .replace(/\sdata-testid="[^"]+"/g, "")
    .replace(/\sdata-sc[a-z-]*="[^"]*"/g, "")
    .replace(/(class="[^"]*xterm-scrollable-element)[^"]*"/g, '$1"');
}
