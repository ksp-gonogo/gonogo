import type { HostIceServers } from "@ksp-gonogo/sitrep-sdk";

const NONE: HostIceServers = { current: () => [], onChange: () => () => {} };

/** The app half of `@ksp-gonogo/sitrep-sdk`'s `useHostIceServers`. There is no relay server to hand out, on any screen. */
export function useHostIceServers(): HostIceServers {
  return NONE;
}
