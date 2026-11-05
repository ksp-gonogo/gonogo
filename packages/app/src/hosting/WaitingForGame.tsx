import { Button, Stack, Text, TextField } from "@ksp-gonogo/ui-kit";
import { useEffect, useState, useSyncExternalStore } from "react";
import styled from "styled-components";
import {
  getSitrepHostConfig,
  setSitrepHostConfig,
  subscribeSitrepHostConfig,
} from "../telemetry/sitrepRuntime";

/** How long the game may stay silent before the screen says more than that it is waiting. */
export const LONG_WAIT_MS = 20_000;

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Whether this page can never open the game's socket at `host`: a page loaded
 * over https may not open an insecure socket to anything but this machine.
 */
export function blockedFromSecurePage(host: string): boolean {
  return (
    globalThis.location.protocol === "https:" &&
    !LOOPBACK.has(host.toLowerCase())
  );
}

/**
 * What a local screen shows until the game answers: no code entry, since a
 * local screen hosts or joins by itself once the game is there. It offers the
 * address it is trying from the first moment, and after a long wait it says
 * the game has not answered.
 */
export function WaitingForGame({
  longWaitMs = LONG_WAIT_MS,
}: {
  longWaitMs?: number;
}) {
  const config = useSyncExternalStore(
    subscribeSitrepHostConfig,
    getSitrepHostConfig,
    getSitrepHostConfig,
  );
  const [long, setLong] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setLong(true), longWaitMs);
    return () => clearTimeout(timer);
  }, [longWaitMs]);

  return (
    <WaitingForGame__Root as="main" aria-label="Waiting for the game">
      <Stack gap="related">
        <WaitingForGame__Heading role="status" aria-live="polite">
          Waiting for the game
        </WaitingForGame__Heading>
        <Text level="muted">
          Looking for the Gonogo mod at {config.host}:{config.port}
        </Text>
        <GameAddress host={config.host} port={config.port} long={long} />
      </Stack>
    </WaitingForGame__Root>
  );
}

function GameAddress({
  host,
  port,
  long,
}: {
  host: string;
  port: number;
  long: boolean;
}) {
  if (blockedFromSecurePage(host)) {
    return (
      <Text tone="warn">
        This page was opened from a secure (https) address, which cannot reach
        the game at {host}. Open it from the address on your own network.
      </Text>
    );
  }
  return <AddressForm host={host} port={port} long={long} />;
}

/** The game's address, to correct when the screen is looking in the wrong place. */
function AddressForm({
  host,
  port,
  long,
}: {
  host: string;
  port: number;
  long: boolean;
}) {
  const [hostText, setHostText] = useState(host);
  const [portText, setPortText] = useState(String(port));
  const portNumber = Number(portText);
  const portInvalid =
    Number.isInteger(portNumber) && portNumber > 0 && portNumber < 65536
      ? undefined
      : "A port is a whole number from 1 to 65535";

  return (
    <WaitingForGame__Form
      onSubmit={(event) => {
        event.preventDefault();
        if (portInvalid || hostText.trim() === "") return;
        setSitrepHostConfig({ host: hostText.trim(), port: portNumber });
      }}
    >
      {long && <Text tone="warn">No answer from the game yet.</Text>}
      <TextField label="Game host" value={hostText} onChange={setHostText} />
      <TextField
        label="Port"
        value={portText}
        onChange={setPortText}
        invalid={portInvalid}
      />
      <Button type="submit">Try this address</Button>
    </WaitingForGame__Form>
  );
}

const WaitingForGame__Root = styled.div`
  display: grid;
  place-items: center;
  min-height: 100vh;
  padding: var(--gutter-screen);
  background: var(--color-surface-app);
  text-align: center;
`;

const WaitingForGame__Heading = styled.h1`
  margin: 0;
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--color-text-primary);
`;

const WaitingForGame__Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  max-width: 22rem;
  margin: 0 auto;
  text-align: left;
`;
