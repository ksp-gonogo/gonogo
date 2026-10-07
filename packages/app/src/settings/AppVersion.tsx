import { Cluster, ReadoutCaption, Stack, Text } from "@ksp-gonogo/ui-kit";
import { useEffect, useState } from "react";
import { usePeerClient } from "../peer/PeerClientContext";
import { VERSION } from "../version";

/**
 * The build this screen is running, and on a station the build of the main
 * screen it is following when that has announced itself.
 */
export function AppVersion() {
  const client = usePeerClient();
  const [hostVersion, setHostVersion] = useState(
    () => client?.getHostVersion() ?? null,
  );

  useEffect(() => {
    if (!client) return;
    setHostVersion(client.getHostVersion());
    return client.onHostHello(setHostVersion);
  }, [client]);

  return (
    <Stack gap="related-comfortable">
      <VersionLine
        label={client ? "This station" : "Gonogo"}
        version={VERSION}
      />
      {hostVersion && (
        <VersionLine label="Main screen" version={hostVersion.version} />
      )}
    </Stack>
  );
}

function VersionLine({ label, version }: { label: string; version: string }) {
  return (
    <Cluster>
      <ReadoutCaption>{label}</ReadoutCaption>
      <Text level="muted" size="sm">
        {version}
      </Text>
    </Cluster>
  );
}
