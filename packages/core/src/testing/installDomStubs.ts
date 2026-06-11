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

  // jsdom has no `window.matchMedia`; components that read media queries at
  // mount (e.g. @jonpepler/kerbcam-react's CameraFeed since 0.21) crash
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

  // Same problem with `fetch`: PeerHostService now fetches /ice-config
  // from the relay on start(). Tests run with no relay listening, so an
  // un-mocked fetch hangs until the abort timeout, slowing every host
  // test by 4 seconds. A 503-returning stub closes the loop instantly
  // and gives the host the same "no TURN, run direct/STUN-only"
  // fallback it'd take if the relay were genuinely unreachable.
  installRelayFetchStub();
}

function installRelayFetchStub(): void {
  if (typeof globalThis === "undefined") return;
  const original = (globalThis as { fetch?: typeof fetch }).fetch;
  // Wrap whatever's there; install a stand-in that returns 503 if no
  // `fetch` exists at all. Either way `/ice-config` resolves
  // synchronously-fast so PeerHostService.start() doesn't hang under
  // tests on the abort-timeout path.
  (globalThis as { fetch: typeof fetch }).fetch = (async (
    input: Parameters<typeof fetch>[0],
    init: Parameters<typeof fetch>[1],
  ) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url.endsWith("/ice-config")) {
      return new Response(JSON.stringify({ error: "test stub" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    }
    if (!original) {
      throw new Error(`no fetch available for ${url}`);
    }
    return original(input as RequestInfo, init);
  }) as typeof fetch;
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
