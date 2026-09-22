import type { ws } from "msw";
import type { PeerClientService } from "../peer/PeerClientService";
import type { PeerHostService } from "../peer/PeerHostService";

/**
 * The connected client an MSW WebSocket link hands its connection listener.
 *
 * Named off `ws.link` rather than restated, so a test pushing one into an array
 * keeps the type MSW actually gives it instead of a local `{ send }` shape that
 * only matches by assertion.
 */
export type LinkClient = Parameters<
  Parameters<ReturnType<typeof ws.link>["addEventListener"]>[1]
>[0]["client"];

/**
 * A fake as the host service under test.
 *
 * The real service opens a broker socket in its constructor, so a test stands
 * in for it with the handful of methods the subject calls. One erasure, here,
 * rather than in each spec.
 */
export function asHostService(fake: unknown): PeerHostService {
  return fake as PeerHostService;
}

/** A fake as the client service under test; see {@link asHostService}. */
export function asClientService(fake: unknown): PeerClientService {
  return fake as PeerClientService;
}
