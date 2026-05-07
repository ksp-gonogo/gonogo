/**
 * Shared jsdom shims used by component/widget tests across the monorepo.
 *
 * jsdom omits several browser APIs that our widgets call at mount time. The
 * options are either to crash, to gate every caller behind `typeof`, or to
 * stub here once — stubbing wins. Each shim is idempotent so setup files can
 * call `installDomStubs()` unconditionally.
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

  // jsdom inherits Node's built-in `WebSocket` (undici-backed). Production
  // code paths that auto-connect on mount (Telemachus, kOS) end up opening
  // real sockets against localhost during tests, then crashing on a Node
  // 24 × undici 7 incompatibility — undici fires events whose `Event` class
  // doesn't satisfy Node's stricter `EventTarget.dispatchEvent` validator
  // ("The 'event' argument must be an instance of Event. Received an
  // instance of Event"). Replace with a no-op EventTarget so unintended
  // network attempts simply hang quietly. Tests that need a controllable
  // WebSocket inject their own fake.
  installNoopWebSocket();
}

function installNoopWebSocket(): void {
  if (typeof globalThis === "undefined") return;
  // Some EventTarget-based runtimes (jsdom + Node) need at least these
  // surface bits so consumer code doesn't crash on construction.
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
  // Cast through unknown — the structural shape matches the WebSocket
  // global closely enough for any consumer that reaches into it.
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = NoopWebSocket;
}
