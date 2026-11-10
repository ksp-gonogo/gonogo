import { Button, Spinner } from "@ksp-gonogo/ui-kit";
import { type FormEvent, useEffect, useState } from "react";
import styled from "styled-components";
import { type LookupResult, lookupGame } from "../peer/lookupGame";
import type { GameFacts } from "../peer/PeerClientService";
import { JoinedGameProvider } from "../settings/JoinedGameContext";
import {
  JoinBox,
  JoinCode,
  JoinInput,
  JoinLayout,
  JoinMuted,
  JoinRow,
} from "./joinParts";
import { PilotScreen } from "./PilotScreen";
import { SEAT_TEXT, SeatCard, SeatCardList } from "./SeatCards";
import { StationScreen } from "./StationScreen";
import {
  codeFromSearch,
  getJoined,
  type JoinSeat,
  joinPath,
  normaliseCode,
  setJoined,
} from "./seatChoice";

type Lookup = (code: string, signal: AbortSignal) => Promise<LookupResult>;

const defaultLookup: Lookup = (code, signal) => lookupGame(code, { signal });

/**
 * `/join?CODE`: the one address anyone opens to join a game. It checks the
 * code with the host, offers the two seats, and joins at the one picked,
 * where the screen waits for the host's approval. A browser that already
 * joined this code goes straight back to its seat. `/join` with no code asks
 * for one.
 */
export function JoinPage({ lookup = defaultLookup }: { lookup?: Lookup }) {
  const [code] = useState(() => codeFromSearch(globalThis.location.search));
  const [seat, setSeat] = useState<JoinSeat | null>(() => {
    const joined = getJoined();
    return joined && joined.code === code ? joined.seat : null;
  });

  useEffect(() => {
    if (seat) return;
    document.title = "gonogo - Join a game";
  }, [seat]);

  if (!code) return <CodeEntry />;
  if (seat) {
    return (
      <JoinedGameProvider game={{ code, seat }}>
        {seat === "station" ? (
          <StationScreen code={code} />
        ) : (
          <PilotScreen code={code} />
        )}
      </JoinedGameProvider>
    );
  }
  return (
    <SeatChoice
      code={code}
      lookup={lookup}
      onChoose={(chosen) => {
        setJoined({ code, seat: chosen });
        setSeat(chosen);
      }}
    />
  );
}

/** Opens the join page for a typed code. */
function goToCode(code: string): void {
  const normal = normaliseCode(code);
  if (normal) globalThis.location.assign(joinPath(normal));
}

function CodeForm({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    goToCode(value);
  };
  return (
    <JoinRow onSubmit={submit}>
      <JoinInput
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Join code"
        aria-label="Join code"
        maxLength={8}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
      />
      <Button type="submit" variant="primary" disabled={!value.trim()}>
        Join
      </Button>
    </JoinRow>
  );
}

function CodeEntry() {
  return (
    <JoinLayout aria-label="Join a game">
      <JoinBox>
        <h1>Join a game</h1>
        <CodeForm />
      </JoinBox>
    </JoinLayout>
  );
}

function SeatChoice({
  code,
  lookup,
  onChoose,
}: {
  code: string;
  lookup: Lookup;
  onChoose: (seat: JoinSeat) => void;
}) {
  const [result, setResult] = useState<LookupResult | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void lookup(code, controller.signal).then((answer) => {
      if (!controller.signal.aborted) setResult(answer);
    });
    return () => controller.abort();
  }, [code, lookup]);

  return (
    <JoinLayout aria-label="Join a game">
      <JoinBox>
        <h1>
          Join <JoinCode>{code}</JoinCode>
        </h1>
        <div role="status" aria-live="polite">
          {result === null && (
            <Looking>
              <Spinner size={16} />
              <JoinMuted>Looking for the game</JoinMuted>
            </Looking>
          )}
          {result?.kind === "none" && (
            <JoinMuted>No game is running on this code</JoinMuted>
          )}
        </div>
        {result?.kind === "none" && <CodeForm />}
        {result?.kind === "found" && (
          <Cards facts={result.facts} onChoose={onChoose} />
        )}
      </JoinBox>
    </JoinLayout>
  );
}

/** "3 stations connected", or nothing when the host did not say. */
function stationsConnected(stations: number | undefined): string | undefined {
  if (stations === undefined) return undefined;
  if (stations === 0) return "No stations connected";
  return stations === 1
    ? "1 station connected"
    : `${stations} stations connected`;
}

function pilotsAboard(pilots: number | undefined): string | undefined {
  if (pilots === undefined) return undefined;
  if (pilots === 0) return "No pilots aboard";
  return pilots === 1 ? "1 pilot aboard" : `${pilots} pilots aboard`;
}

function Cards({
  facts,
  onChoose,
}: {
  facts: GameFacts;
  onChoose: (seat: JoinSeat) => void;
}) {
  return (
    <SeatCardList>
      <SeatCard
        title="Join as a station"
        fact={stationsConnected(facts.stations)}
        onChoose={() => onChoose("station")}
      >
        {`A screen at mission control. ${SEAT_TEXT.commandCentre}`}
      </SeatCard>
      <SeatCard
        title="Join as a pilot"
        fact={pilotsAboard(facts.pilots)}
        onChoose={() => onChoose("pilot")}
      >
        {SEAT_TEXT.pilot}
      </SeatCard>
    </SeatCardList>
  );
}

const Looking = styled.div`
  display: flex;
  align-items: center;
  gap: var(--gap-related);
`;
