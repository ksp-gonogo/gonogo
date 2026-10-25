/**
 * Adds the browser APIs jsdom lacks and widgets call when they mount, so a
 * widget renders in a jsdom test: a `ResizeObserver` that does nothing, a
 * canvas `getContext` that returns `null` (so a widget takes its no-canvas
 * path), a `HTMLMediaElement.play` that resolves, a `matchMedia` that never
 * matches, and a `WebSocket` that connects to nothing. Safe to call more than
 * once. Call it from a test setup file. Useful for testing how a
 * widget mounts, as the operator sees it, in a jsdom test. Used by the test setup of the app and of each bundled Uplink's client.
 *
 * @example
 * ```ts
 * // test-setup.ts, listed under `setupFiles` in the vitest config
 * import { installDomStubs } from "@ksp-gonogo/sitrep-sdk/testing";
 *
 * installDomStubs();
 * ```
 *
 * @category Rendering
 */
export function installDomStubs(): void {
  if (
    typeof globalThis !== "undefined" &&
    typeof globalThis.ResizeObserver === "undefined"
  ) {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }

  // jsdom prints a loud "Not implemented" warning every time a canvas mounts.
  // Widgets use it to test for 2d support and gracefully degrade; returning
  // null routes them onto that path.
  if (typeof HTMLCanvasElement !== "undefined") {
    HTMLCanvasElement.prototype.getContext = () => null;
  }

  // HTMLMediaElement.play is undefined in jsdom; code that awaits it (or
  // chains .catch) explodes. A resolved Promise keeps the await-chain quiet
  // without pretending the video actually played.
  if (typeof HTMLMediaElement !== "undefined") {
    HTMLMediaElement.prototype.play = () => Promise.resolve();
  }

  // jsdom inherits Node's built-in `WebSocket` (undici-backed). Any code path
  // that auto-connects on mount ends up opening a real socket against
  // localhost during tests, then crashing on a Node
  // 24 × undici 7 incompatibility: undici fires events whose `Event` class
  // doesn't satisfy Node's stricter `EventTarget.dispatchEvent` validator
  // ("The 'event' argument must be an instance of Event. Received an
  // instance of Event"). Replace with a no-op EventTarget so unintended
  // network attempts simply hang quietly. Tests that need a controllable
  // WebSocket inject their own fake.
  installNoopWebSocket();

  // jsdom has no `window.matchMedia`; components that read media queries at
  // mount (e.g. @ksp-gonogo/kerbcast's CameraFeed since 0.21) crash
  // without it. A never-matching stub keeps them on the default branch.
  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia !== "function"
  ) {
    window.matchMedia = (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList;
  }
}

function installNoopWebSocket(): void {
  if (typeof globalThis === "undefined") return;
  // Some EventTarget-based runtimes (jsdom + Node) need at least these surface bits so consumer code doesn't crash on construction.
  class NoopWebSocket extends EventTarget {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSING = 2;
    readonly CLOSED = 3;

    readyState = 0;
    url: string;
    binaryType: "blob" | "arraybuffer" = "blob";
    bufferedAmount = 0;
    extensions = "";
    protocol = "";

    onopen: ((ev: Event) => unknown) | null = null;
    onclose: ((ev: Event) => unknown) | null = null;
    onerror: ((ev: Event) => unknown) | null = null;
    onmessage: ((ev: MessageEvent) => unknown) | null = null;

    constructor(url: string | URL, _protocols?: string | string[]) {
      super();
      this.url = String(url);
    }
    send(_data: unknown): void {}
    close(_code?: number, _reason?: string): void {
      this.readyState = 3;
    }
  }
  /* The structural shape matches the WebSocket global closely enough for any
     consumer that reaches into it. */
  Reflect.set(globalThis, "WebSocket", NoopWebSocket);
}
