/**
 * The router's address and this computer's address on the router's network,
 * read from the host's default route, as shell statements for `scripts/dev.sh`.
 *
 * A container on a virtual network cannot see either: its default route leads
 * to the virtual network's own gateway. The relay takes them from `ROUTER_IP`
 * and `LAN_IP`, so the host passes them in.
 *
 * Prints nothing when the route cannot be read, which leaves the relay to look
 * for the router itself.
 */

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** @param {string} out `route -n get default` output on macOS */
export function parseMacRoute(out) {
  const gateway = /^\s*gateway:\s*(\S+)/m.exec(out)?.[1] ?? null;
  const iface = /^\s*interface:\s*(\S+)/m.exec(out)?.[1] ?? null;
  return { gateway: gateway && IPV4.test(gateway) ? gateway : null, iface };
}

/** @param {string} out `ip route get 1.1.1.1` output on Linux */
export function parseLinuxRoute(out) {
  const word = (name) =>
    new RegExp(`\\b${name}\\s+(\\S+)`).exec(out)?.[1] ?? null;
  const gateway = word("via");
  return {
    gateway: gateway && IPV4.test(gateway) ? gateway : null,
    lanIp: word("src"),
  };
}

/** @param {string} out `route print -4 0.0.0.0` output on Windows */
export function parseWindowsRoute(out) {
  let best = null;
  for (const line of out.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols[0] !== "0.0.0.0" || cols[1] !== "0.0.0.0" || cols.length < 5) {
      continue;
    }
    const [, , gateway, lanIp, metric] = cols;
    if (!IPV4.test(gateway) || !IPV4.test(lanIp)) continue;
    if (!best || Number(metric) < best.metric) {
      best = { gateway, lanIp, metric: Number(metric) };
    }
  }
  return best ? { gateway: best.gateway, lanIp: best.lanIp } : null;
}

const run = (file, args) =>
  execFileSync(file, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

/** @returns {{ routerIp: string, lanIp: string } | null} */
export function detectHostNetwork(platform = process.platform) {
  try {
    if (platform === "darwin") {
      const { gateway, iface } = parseMacRoute(
        run("route", ["-n", "get", "default"]),
      );
      if (!gateway || !iface) return null;
      const lanIp = run("ipconfig", ["getifaddr", iface]).trim();
      return IPV4.test(lanIp) ? { routerIp: gateway, lanIp } : null;
    }
    if (platform === "linux") {
      const { gateway, lanIp } = parseLinuxRoute(
        run("ip", ["route", "get", "1.1.1.1"]),
      );
      return gateway && lanIp && IPV4.test(lanIp)
        ? { routerIp: gateway, lanIp }
        : null;
    }
    if (platform === "win32") {
      const found = parseWindowsRoute(run("route", ["print", "-4", "0.0.0.0"]));
      return found ? { routerIp: found.gateway, lanIp: found.lanIp } : null;
    }
  } catch {
    return null;
  }
  return null;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const found = detectHostNetwork();
  if (found) {
    console.log(`${found.routerIp} ${found.lanIp}`);
  }
}
