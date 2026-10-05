import { act, renderHook, waitFor } from "@ksp-gonogo/test-utils";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { useRelayHealth } from "./useRelayHealth";

const HEALTH_URL = "http://localhost:3002/health";
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("useRelayHealth", () => {
  it("reads ok once the relay answers", async () => {
    server.use(
      http.get(HEALTH_URL, () =>
        HttpResponse.json({ status: "ok", turn: null }),
      ),
    );
    const { result } = renderHook(() => useRelayHealth());
    expect(result.current.health).toBe("checking");
    await waitFor(() => expect(result.current.health).toBe("ok"));
  });

  it("reads unreachable when nothing is listening, and when something else answers on the port", async () => {
    server.use(http.get(HEALTH_URL, () => HttpResponse.error()));
    const refused = renderHook(() => useRelayHealth());
    await waitFor(() =>
      expect(refused.result.current.health).toBe("unreachable"),
    );
    refused.unmount();

    server.use(http.get(HEALTH_URL, () => HttpResponse.json({ hello: 1 })));
    const stranger = renderHook(() => useRelayHealth());
    await waitFor(() =>
      expect(stranger.result.current.health).toBe("unreachable"),
    );
  });

  it("asks again on recheck and picks up a relay that has since started", async () => {
    server.use(http.get(HEALTH_URL, () => HttpResponse.error()));
    const { result } = renderHook(() => useRelayHealth());
    await waitFor(() => expect(result.current.health).toBe("unreachable"));

    server.use(
      http.get(HEALTH_URL, () =>
        HttpResponse.json({ status: "ok", turn: null }),
      ),
    );
    act(() => result.current.recheck());
    await waitFor(() => expect(result.current.health).toBe("ok"));
  });
});
