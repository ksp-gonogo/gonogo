import cors from "@fastify/cors";
import type { FastifyInstance, FastifyRequest } from "fastify";

/** Where the released and release-candidate apps are served from. */
export const PUBLIC_APP_ORIGIN = "https://ksp-gonogo.github.io";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Whether a page at `origin` is a gonogo app this relay serves: the public
 * build, an app opened on this machine's loopback address at any port (the
 * bundle's `:8080`, `pnpm dev`, a preview), an app served from the host the
 * request was addressed to by IP address (`requestHost`, the request's
 * `Host`, so a build pointed at `http://198.51.100.20:3002` serves its page at
 * `http://198.51.100.20:8080`), or one of the operator's `extraOrigins`.
 *
 * The same-host match takes an IP address only. A name would let a page on a
 * domain re-pointed at this machine (a rebinding attack) match itself, since
 * its `Origin` and `Host` both carry that domain.
 *
 * The relay hands out relay credentials and takes the analytics consent, so
 * any other page the main screen's browser opens must not reach either.
 */
export function isAppOrigin(
  origin: string,
  extraOrigins: ReadonlySet<string> = new Set(),
  requestHost?: string,
): boolean {
  if (origin === PUBLIC_APP_ORIGIN || extraOrigins.has(origin)) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.origin !== origin) return false;
  if (LOOPBACK_HOSTS.has(url.hostname)) return true;
  return isIpLiteral(url.hostname) && url.hostname === hostnameOf(requestHost);
}

function isIpLiteral(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith("[");
}

/** The hostname of a `Host` header, without its port; undefined for none or an unparseable one. */
function hostnameOf(host: string | undefined): string | undefined {
  if (!host) return undefined;
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return undefined;
  }
}

/**
 * Serve only the gonogo app's own pages. CORS answers an app origin and no
 * other, and a request carrying any other `Origin` is refused with 403 before
 * a route runs, because CORS alone stops a page reading a response, not
 * sending the request (a `POST` to `/analytics-config` would still land).
 *
 * A request with no `Origin` (curl on this machine) is served: the relay's
 * HTTP port is published on loopback only, so that caller is already local.
 */
export async function registerAppOrigins(
  fastify: FastifyInstance,
  extraOrigins: ReadonlySet<string>,
): Promise<void> {
  const allowed = (req: FastifyRequest) => {
    const origin = req.headers.origin;
    return (
      origin !== undefined &&
      isAppOrigin(origin, extraOrigins, req.headers.host)
    );
  };
  fastify.addHook("onRequest", async (req, reply) => {
    if (req.headers.origin === undefined || allowed(req)) return;
    return reply.status(403).send({ error: "origin not allowed" });
  });
  await fastify.register(cors, {
    delegator: (req, cb) => cb(null, { origin: allowed(req) }),
  });
}
