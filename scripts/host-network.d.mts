export function parseMacRoute(out: string): {
  gateway: string | null;
  iface: string | null;
};
export function parseLinuxRoute(out: string): {
  gateway: string | null;
  lanIp: string | null;
};
export function parseWindowsRoute(
  out: string,
): { gateway: string; lanIp: string } | null;
export function detectHostNetwork(
  platform?: string,
): { routerIp: string; lanIp: string } | null;
