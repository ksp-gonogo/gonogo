import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { readUplinkDeclaration } from "@ksp-gonogo/sitrep-sdk/uplink-manifest";
import type { PluginOption } from "vite";
import type {
  LocalUplinkState,
  LocalUplinkStatus,
} from "./src/uplinks/localUplinks";
import { buildUplinkClientBundle } from "./uplink-bundle";
import { UPLINK_BUNDLE_TARGETS } from "./uplink-bundle-targets";

/** Where `uplink-tools bundle --watch` leaves its state, beside the bundle. */
const WATCH_STATUS_FILE = "watch-status.json";
const SIDECAR_FILE = "gonogo-uplink.json";

/** How many superseded builds of one Uplink stay servable by hash. */
const SNAPSHOTS_KEPT = 8;

export type { LocalUplinkState, LocalUplinkStatus };

interface IndexVersion {
  version: string;
  minAppVersion: string;
  apiVersion: string;
  contractMajor: number;
  contractMinor: number;
  bundleUrl: string;
  integrity: string;
  expectedClientHash: null;
}

export interface LocalIndexEntry {
  id: string;
  name: string;
  author: string;
  repo: string;
  source: "local";
  versions: IndexVersion[];
}

interface Sidecar {
  name?: string;
  author?: string;
  repo?: string;
  version?: string;
  minAppVersion?: string;
  apiVersion?: string;
  contractMajor?: number;
  contractMinor?: number;
}

interface WatchStatus {
  state?: LocalUplinkState;
  builtAt?: string | null;
  error?: string | null;
}

interface Resolved {
  id: string;
  path: string;
  bundleDir: string;
  bundleFile: string;
  snapshots: Map<string, Buffer>;
}

/** The newline-separated absolute paths `pnpm dev --uplink` hands the dev server. */
export function parseLocalUplinkPaths(value: string | undefined): string[] {
  return (value ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

/**
 * An Uplink checkout resolved to where its bundle will appear.
 *
 * The path is the Uplink's root, the directory holding `uplink.json`, with its
 * client in `client/` (or the path itself when it is a flat client package).
 */
function resolveUplink(rawPath: string): Resolved {
  const path = resolve(rawPath.replace(/^~(?=$|\/)/, homedir()));
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new Error(
      `--uplink ${path}: no such directory. Name an Uplink's directory, the one holding uplink.json.`,
    );
  }
  const clientDir = existsSync(join(path, "client", "package.json"))
    ? join(path, "client")
    : path;
  const declaration = readUplinkDeclaration(clientDir);
  const id = declaration?.declared.id;
  if (!id) {
    throw new Error(
      `--uplink ${path}: no uplink.json declaring an id in it or the directory above. Name an Uplink's directory, the one holding uplink.json.`,
    );
  }
  const bundleDir = join(clientDir, "dist", id);
  return {
    id,
    path,
    bundleDir,
    bundleFile: join(bundleDir, `${id}.client.js`),
    snapshots: new Map(),
  };
}

const hashOf = (bytes: Buffer) =>
  `sha256-${createHash("sha256").update(bytes).digest("hex")}`;

/**
 * The Uplinks named with `--uplink`, read from their own build output.
 *
 * Every figure here comes from the bundle and its sidecar, never from the host's
 * constants: a local build that was made against another contract is exactly
 * what the row in Settings has to be able to show, and copying the host's
 * numbers into its index entry would turn that mismatch into a pass.
 */
export function createLocalUplinks(rawPaths: readonly string[]) {
  const uplinks = rawPaths.map(resolveUplink);
  const byId = new Map(uplinks.map((u) => [u.id, u]));

  /*
   * The bytes are snapshotted by hash the moment an index names them, so a
   * rebuild between the index fetch and the bundle fetch serves what the index
   * promised. Serving the new bytes instead would fail the loader's integrity
   * check and read as tampering.
   */
  const remember = (uplink: Resolved, bytes: Buffer): string => {
    const hash = hashOf(bytes);
    uplink.snapshots.delete(hash);
    uplink.snapshots.set(hash, bytes);
    for (const old of uplink.snapshots.keys()) {
      if (uplink.snapshots.size <= SNAPSHOTS_KEPT) break;
      uplink.snapshots.delete(old);
    }
    return hash;
  };

  const readBundle = (uplink: Resolved): Buffer | undefined => {
    try {
      return readFileSync(uplink.bundleFile);
    } catch {
      return undefined;
    }
  };

  const index = (): LocalIndexEntry[] => {
    const entries: LocalIndexEntry[] = [];
    for (const uplink of uplinks) {
      const bytes = readBundle(uplink);
      const sidecar = readJson<Sidecar>(join(uplink.bundleDir, SIDECAR_FILE));
      if (!bytes || !sidecar) continue;
      const integrity = remember(uplink, bytes);
      entries.push({
        id: uplink.id,
        name: sidecar.name ?? uplink.id,
        author: sidecar.author ?? "",
        repo: sidecar.repo ?? "",
        source: "local",
        versions: [
          {
            version: sidecar.version ?? "0.0.0",
            minAppVersion: sidecar.minAppVersion ?? "0.0.0",
            apiVersion: sidecar.apiVersion ?? "",
            contractMajor: sidecar.contractMajor ?? 0,
            contractMinor: sidecar.contractMinor ?? 0,
            bundleUrl: `/uplinks/local/${uplink.id}/${uplink.id}.client.js?h=${integrity}`,
            integrity,
            expectedClientHash: null,
          },
        ],
      });
    }
    return entries;
  };

  const statuses = (): LocalUplinkStatus[] =>
    uplinks.map((uplink) => {
      const sidecar = readJson<Sidecar>(join(uplink.bundleDir, SIDECAR_FILE));
      const watch = readJson<WatchStatus>(
        join(uplink.bundleDir, WATCH_STATUS_FILE),
      );
      const hasBundle = existsSync(uplink.bundleFile);
      // A bundle built once by `bundle` has no watch file and is simply built.
      const state: LocalUplinkState = watch?.state
        ? hasBundle || watch.state !== "built"
          ? watch.state
          : "waiting"
        : hasBundle
          ? "built"
          : "waiting";
      return {
        id: uplink.id,
        name: sidecar?.name ?? uplink.id,
        path: uplink.path,
        state,
        error: watch?.error ?? null,
        builtAt:
          watch?.builtAt ??
          (hasBundle ? statSync(uplink.bundleFile).mtime.toISOString() : null),
        version: sidecar?.version ?? null,
        apiVersion: sidecar?.apiVersion ?? null,
      };
    });

  const bundle = (id: string, hash: string): Buffer | undefined => {
    const uplink = byId.get(id);
    if (!uplink) return undefined;
    const held = uplink.snapshots.get(hash);
    if (held) return held;
    const current = readBundle(uplink);
    return current && hashOf(current) === hash ? current : undefined;
  };

  const sidecar = (id: string): string | undefined => {
    const uplink = byId.get(id);
    if (!uplink) return undefined;
    try {
      return readFileSync(join(uplink.bundleDir, SIDECAR_FILE), "utf8");
    } catch {
      return undefined;
    }
  };

  return {
    uplinks,
    index,
    statuses,
    bundle,
    sidecar,
  };
}

export interface LocalUplinksOptions {
  /** The host's own compat identity, stamped on the bundled Uplinks' entries. */
  host: {
    apiVersion: string;
    contractMajor: number;
    contractMinor: number;
  };
  appVersion: string;
}

/**
 * Serves the Uplink index and bundles under `vite dev`, which builds none.
 *
 * The bundled Uplinks are built once at start with the same bundler the release
 * build uses, so `pnpm dev` shows them instead of leaving them silently absent.
 * Each `--uplink` is read from its own build output and served beside them,
 * and a rebuild reloads the page: a hot swap is unsafe because
 * `registerComponent` throws on a differing definition under the same id.
 */
export function localUplinks(options: LocalUplinksOptions): PluginOption {
  return {
    name: "gonogo-local-uplinks",
    apply: "serve",
    async configureServer(server) {
      const local = createLocalUplinks(
        parseLocalUplinkPaths(process.env.GONOGO_LOCAL_UPLINKS),
      );

      const cacheDir = resolve(
        import.meta.dirname,
        "node_modules/.cache/gonogo-dev-uplinks",
      );
      const bundled: Record<string, unknown>[] = [];
      const bundledBytes = new Map<string, Buffer>();
      for (const target of UPLINK_BUNDLE_TARGETS) {
        try {
          const built = await buildUplinkClientBundle({
            clientDir: target.clientDir,
            outFile: join(cacheDir, `${target.id}.client.js`),
          });
          bundledBytes.set(target.id, built.bytes);
          bundled.push({
            id: target.id,
            name: target.name,
            author: target.author,
            repo: target.repo,
            versions: [
              {
                version: options.appVersion,
                minAppVersion: options.appVersion,
                ...options.host,
                bundleUrl: `/uplinks/bundled/${target.id}.client.js`,
                integrity: built.integrity,
                expectedClientHash: null,
              },
            ],
          });
        } catch (err) {
          server.config.logger.warn(
            `[uplinks] ${target.id} did not build, so it is absent from this dev server: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }

      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const send = (body: string | Buffer, type: string) => {
          res.setHeader("content-type", type);
          res.setHeader("cache-control", "no-store");
          res.end(body);
        };

        if (url.pathname === "/uplinks/registry.local.json") {
          return send(
            JSON.stringify({
              generatedAt: new Date().toISOString(),
              uplinks: [...bundled, ...local.index()],
            }),
            "application/json",
          );
        }
        if (url.pathname === "/__gonogo/local-uplinks.json") {
          return send(JSON.stringify(local.statuses()), "application/json");
        }
        const bundledMatch = /^\/uplinks\/bundled\/([^/]+)\.client\.js$/.exec(
          url.pathname,
        );
        const bundledBody = bundledMatch && bundledBytes.get(bundledMatch[1]);
        if (bundledBody) return send(bundledBody, "text/javascript");

        const localMatch = /^\/uplinks\/local\/([^/]+)\/(.+)$/.exec(
          url.pathname,
        );
        if (localMatch) {
          const [, id, file] = localMatch;
          const sidecar = file === "gonogo-uplink.json" && local.sidecar(id);
          if (sidecar) return send(sidecar, "application/json");
          const body =
            file === `${id}.client.js` &&
            local.bundle(id, url.searchParams.get("h") ?? "");
          if (body) return send(body, "text/javascript");
          res.statusCode = 404;
          return send("not found", "text/plain");
        }
        next();
      });

      if (local.uplinks.length > 0) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        for (const uplink of local.uplinks) {
          server.watcher.add(uplink.bundleDir);
        }
        server.watcher.on("all", (_event, file) => {
          if (!local.uplinks.some((u) => file.startsWith(u.bundleDir))) return;
          if (file.endsWith(".tmp")) return;
          clearTimeout(timer);
          timer = setTimeout(
            () => server.ws.send({ type: "full-reload" }),
            150,
          );
        });
      }

      server.httpServer?.once("listening", () => {
        if (local.uplinks.length === 0) {
          server.config.logger.info(
            `[uplinks] ${bundled.length} bundled client(s) built for this dev server. Serve one you are building with \`pnpm dev --uplink <path>\``,
          );
          return;
        }
        const lines = local.statuses().map((s) => {
          const detail =
            s.state === "built"
              ? `built ${s.builtAt ?? ""}, extension API ${s.apiVersion}`
              : s.state === "failed"
                ? `build failed: ${s.error}`
                : "waiting for the first build";
          return `    ${s.id}   ${s.path}   ${detail}`;
        });
        server.config.logger.info(["Local Uplinks:", ...lines].join("\n"));
      });
    },
  };
}
