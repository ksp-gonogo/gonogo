import type { RendezvousHudContext } from "./slots";

type Port = NonNullable<RendezvousHudContext["targetPort"]>;

const names = new Map<string, string>();

const keyOf = (port: Port) =>
  `${port.vesselPersistentId}:${port.portPersistentId}`;

/**
 * Notes the name a targeted docking port went by. KSP clears the target as the
 * ports dock and the active vessel changes with it, so the name is looked up by
 * the port's persistent ids afterwards, which the docking channel keeps sending.
 */
export function rememberPortName(port: Port, name: string): void {
  names.set(keyOf(port), name);
}

/** The name a docking port was targeted under, or an empty string where it never was. */
export function recallPortName(port: Port | undefined): string {
  return port === undefined ? "" : (names.get(keyOf(port)) ?? "");
}
