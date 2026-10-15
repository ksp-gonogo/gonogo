import { useStream } from "@ksp-gonogo/sitrep-client";
import { CommandBlock } from "@ksp-gonogo/ui";
import { Cluster, ReadoutCaption, Stack, Text } from "@ksp-gonogo/ui-kit";
import { useEffect, useState, useSyncExternalStore } from "react";
import styled from "styled-components";
import {
  browserShell,
  runCommandFor,
  UPDATE_PULL_COMMAND,
  UPDATE_REMOVE_COMMAND,
} from "../firstRun/setupGuide";
import { usePeerClient } from "../peer/PeerClientContext";
import {
  assessModHandshake,
  describeMinorDifference,
} from "../telemetry/modHandshake";
import {
  getSitrepHello,
  subscribeSitrepHello,
} from "../telemetry/sitrepRuntime";
import { hostCompat } from "../uplinks/hostCompat";
import { VERSION } from "../version";
import {
  checkLatestRelease,
  isNewer,
  type LatestRelease,
  latestReleaseSoFar,
  modMatchesApp,
  modVersionText,
} from "./releaseCheck";

/** The one field of `system.uplinks` this reads. */
interface SystemUplinksRelease {
  coreVersion?: string | null;
}

/** The newest release once asked: `checking` until GitHub answers, `null` when it cannot be known. */
function useLatestRelease(): LatestRelease | null | "checking" {
  const [latest, setLatest] = useState<LatestRelease | null | "checking">(
    () => {
      const known = latestReleaseSoFar();
      return known === undefined ? "checking" : known;
    },
  );
  useEffect(() => {
    let live = true;
    void checkLatestRelease().then((release) => {
      if (live) setLatest(release);
    });
    return () => {
      live = false;
    };
  }, []);
  return latest;
}

/**
 * The mod's release label off `system.uplinks`: a string when the mod reports
 * one, `null` when it is connected and records none, `undefined` while nothing
 * has arrived.
 */
function useModVersion(): string | null | undefined {
  const reading = useStream<SystemUplinksRelease>("system.uplinks");
  if (reading.state !== "observed" && reading.state !== "held")
    return undefined;
  return reading.value.coreVersion ?? null;
}

/**
 * The build this screen is running, the mod's, and the newest published
 * release. On the main screen, a newer release brings the commands that update
 * the container. A release that could not be checked is shown as unknown,
 * never as current.
 */
export function AppVersion() {
  const client = usePeerClient();
  const [hostVersion, setHostVersion] = useState(
    () => client?.getHostVersion() ?? null,
  );
  const latest = useLatestRelease();
  const streamModVersion = useModVersion();
  const hello = useSyncExternalStore(subscribeSitrepHello, getSitrepHello);
  // The hello names the mod's release label; a mod too old to send one is still reported by system.uplinks.
  const modVersion = hello?.modVersion ?? streamModVersion;
  const handshake = hello ? assessModHandshake(hello, hostCompat) : undefined;
  const minorNote = handshake ? describeMinorDifference(handshake) : null;

  useEffect(() => {
    if (!client) return;
    setHostVersion(client.getHostVersion());
    return client.onHostHello(setHostVersion);
  }, [client]);

  const known = latest !== "checking" && latest !== null ? latest : undefined;
  const behind = known ? isNewer(known.version, VERSION) === true : false;
  const mismatch = modMatchesApp(modVersion, VERSION) === false;

  return (
    <Stack gap="related-comfortable">
      <VersionLine
        label={client ? "This station" : "Gonogo"}
        version={VERSION}
      />
      {hostVersion && (
        <VersionLine label="Main screen" version={hostVersion.version} />
      )}
      {modVersion !== undefined && (
        <VersionLine
          label="Mod"
          version={
            modVersion === null
              ? "Not recorded by this build"
              : modVersionText(modVersion)
          }
        />
      )}
      {handshake?.kind === "too-old" && (
        <VersionLine label="Contract" version="Mod too old to say" />
      )}
      {hello && handshake?.kind !== "too-old" && (
        <VersionLine
          label="Contract"
          version={`${hello.contractMajor}.${hello.contractMinor}`}
        />
      )}
      <Cluster>
        <ReadoutCaption>Latest release</ReadoutCaption>
        <Text level="muted" size="sm">
          {latest === "checking" && "Checking"}
          {latest === null && "Could not check"}
          {known &&
            (known.url ? (
              <ReleaseLink href={known.url} target="_blank" rel="noreferrer">
                {known.version}
              </ReleaseLink>
            ) : (
              known.version
            ))}
        </Text>
      </Cluster>
      {mismatch && (
        <Text tone="warn" size="sm">
          The mod and this app are from different releases. Update both to the
          same one.
        </Text>
      )}
      {minorNote && (
        <Text level="muted" size="sm">
          {minorNote}
        </Text>
      )}
      {!client && behind && known && <UpdateSteps version={known.version} />}
    </Stack>
  );
}

/** How to move the container to the newest image, and the reminder that the mod moves with it. */
function UpdateSteps({ version }: Readonly<{ version: string }>) {
  return (
    <Stack gap="related">
      <Text size="sm">
        Gonogo {version} is out. To update, run these in a terminal:
      </Text>
      <CommandBlock command={UPDATE_PULL_COMMAND} label="pull command" />
      <CommandBlock command={UPDATE_REMOVE_COMMAND} label="remove command" />
      <CommandBlock
        command={runCommandFor(browserShell())}
        label="run command"
      />
      <Text level="muted" size="sm">
        Update the Gonogo mod in KSP to the same release; CKAN offers it as an
        update.
      </Text>
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

const ReleaseLink = styled.a`
  color: var(--color-accent-fg);

  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;
