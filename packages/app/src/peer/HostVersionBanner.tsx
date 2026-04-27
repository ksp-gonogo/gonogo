import { compareVersions, logger } from "@gonogo/core";
import { VersionMismatchBanner } from "@gonogo/ui";
import { useEffect, useState } from "react";
import { VERSION } from "../version";
import type { PeerClientService } from "./PeerClientService";

interface Props {
  client: PeerClientService;
}

/**
 * Subscribes to the host's `hello` and renders a banner when the host's
 * version doesn't match this station's. Sits below `SignalLossBanner`
 * (top: 56px in the UI primitive) so signal loss takes precedence when
 * both are active.
 *
 * Patch-only differences are silent — they don't render a banner,
 * matching the doc's UX table (tooltip only, no visible chrome).
 */
export function HostVersionBanner({ client }: Props) {
  const [hostVersion, setHostVersion] = useState(() =>
    client.getHostVersion(),
  );

  useEffect(() => {
    setHostVersion(client.getHostVersion());
    return client.onHostHello((info) => {
      setHostVersion(info);
    });
  }, [client]);

  const kind = compareVersions(VERSION, hostVersion?.version);
  // biome-ignore lint/correctness/useExhaustiveDependencies: log once per mismatch transition
  useEffect(() => {
    if (kind === "same") return;
    if (kind === "patch") {
      logger.info(
        `[version] patch-only difference with host — local=${VERSION} remote=${hostVersion?.version}`,
      );
      return;
    }
    logger.warn(
      `[version] mismatch with host — local=${VERSION} remote=${hostVersion?.version ?? "?"} kind=${kind}`,
    );
  }, [kind, hostVersion?.version]);

  if (kind === "same" || kind === "patch") return null;

  return (
    <VersionMismatchBanner
      kind={kind}
      local={VERSION}
      remote={hostVersion?.version}
      remoteLabel="Mission Control"
    />
  );
}
