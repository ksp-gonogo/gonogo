/** The seat a screen that reads the game itself sits at: mission control or a pilot. */
export type StartSeat = "main" | "pilot";

/** The seat a screen that joined a game by its code sits at. */
export type JoinSeat = "station" | "pilot";

const START_SEAT_KEY = "gonogo-start-seat";
const JOINED_KEY = "gonogo-joined";

const startListeners = new Set<() => void>();

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage refused: the choice lasts this page load only */
  }
}

/**
 * The seat this browser's local screen opens in: the one chosen at the end of
 * the setup, or since switched to. Mission control when none was chosen.
 */
export function getStartSeat(): StartSeat {
  return read(START_SEAT_KEY) === "pilot" ? "pilot" : "main";
}

/** Whether a start seat has been chosen in this browser. */
export function hasStartSeat(): boolean {
  return read(START_SEAT_KEY) !== null;
}

export function setStartSeat(seat: StartSeat): void {
  write(START_SEAT_KEY, seat);
  for (const cb of [...startListeners]) cb();
}

export function subscribeStartSeat(cb: () => void): () => void {
  startListeners.add(cb);
  return () => {
    startListeners.delete(cb);
  };
}

/** The game this browser joined by code and the seat it took, or null. */
export function getJoined(): { code: string; seat: JoinSeat } | null {
  const raw = read(JOINED_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const code = Reflect.get(parsed, "code");
    const seat = Reflect.get(parsed, "seat");
    if (typeof code !== "string") return null;
    if (seat !== "station" && seat !== "pilot") return null;
    return { code, seat };
  } catch {
    return null;
  }
}

export function setJoined(joined: { code: string; seat: JoinSeat } | null) {
  write(JOINED_KEY, joined ? JSON.stringify(joined) : null);
}

/** Normalise a typed or linked code the way the host's own codes are written. */
export function normaliseCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * The join page for `code`, under the app's base path: `/join?CODE`, or
 * `/join` to ask for one. Every link a screen makes to it goes through here,
 * since the app is served from a sub-path on the hosted site.
 */
export function joinPath(code?: string): string {
  const base = import.meta.env.BASE_URL;
  return code ? `${base}join?${encodeURIComponent(code)}` : `${base}join`;
}

/** The code in a join page's address: the whole query, `/join?CODE`. */
export function codeFromSearch(search: string): string {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const first = raw.split("&")[0] ?? "";
  try {
    return normaliseCode(decodeURIComponent(first));
  } catch {
    return normaliseCode(first);
  }
}

/** Leave the joined game: forget the seat and open the join page with no code. */
export function leaveGame(): void {
  setJoined(null);
  globalThis.location.assign(joinPath());
}
