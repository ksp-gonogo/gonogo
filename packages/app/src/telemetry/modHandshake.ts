/** What the mod's `hello` frame said about itself; every field is absent from a mod built before the frame carried them. */
export interface ModHello {
  modVersion?: string | null;
  contractMajor?: number;
  contractMinor?: number;
}

/** The contract this app was built against. */
export interface AppContract {
  contractMajor: number;
  contractMinor: number;
}

/**
 * How the mod's contract compares with the app's. `too-old` is a mod whose hello
 * names no contract at all, which only a mod from before the handshake sends.
 */
export type ModHandshake =
  | { kind: "match" }
  | { kind: "too-old" }
  | { kind: "mod-major-older"; modMajor: number; appMajor: number }
  | { kind: "mod-major-newer"; modMajor: number; appMajor: number }
  | { kind: "mod-minor-newer"; modMinor: number; appMinor: number }
  | { kind: "app-minor-newer"; modMinor: number; appMinor: number };

/**
 * Compares the contract a mod announced with the one this app was built for.
 * A different major is the only mismatch that breaks the stream; a different
 * minor is reported so Settings can say which side is behind. Used by the
 * mismatch banner on the main screen and by the version lines in Settings.
 */
export function assessModHandshake(
  hello: ModHello,
  app: AppContract,
): ModHandshake {
  const { contractMajor: modMajor, contractMinor: modMinor } = hello;
  if (typeof modMajor !== "number" || typeof modMinor !== "number") {
    return { kind: "too-old" };
  }
  if (modMajor < app.contractMajor) {
    return {
      kind: "mod-major-older",
      modMajor,
      appMajor: app.contractMajor,
    };
  }
  if (modMajor > app.contractMajor) {
    return {
      kind: "mod-major-newer",
      modMajor,
      appMajor: app.contractMajor,
    };
  }
  if (modMinor > app.contractMinor) {
    return { kind: "mod-minor-newer", modMinor, appMinor: app.contractMinor };
  }
  if (modMinor < app.contractMinor) {
    return { kind: "app-minor-newer", modMinor, appMinor: app.contractMinor };
  }
  return { kind: "match" };
}

/** Whether the handshake is one that leaves the stream unreadable: a different major, or a mod too old to say. */
export function isBreakingHandshake(handshake: ModHandshake): boolean {
  return (
    handshake.kind === "too-old" ||
    handshake.kind === "mod-major-older" ||
    handshake.kind === "mod-major-newer"
  );
}

/**
 * The sentence that names both sides of a breaking handshake and says which to
 * update, in the operator's words. `null` for a handshake that leaves the
 * stream readable.
 */
export function describeBreakingHandshake(
  handshake: ModHandshake,
  modLabel: string | null | undefined,
  appVersion: string,
): string | null {
  const mod = modLabel ? `mod ${modLabel.replace(/^v(?=\d)/i, "")}` : "the mod";
  switch (handshake.kind) {
    case "too-old":
      return `The mod is too old to report its version, so it cannot be read by this app (${appVersion}). Update the mod.`;
    case "mod-major-older":
      return `The mod speaks contract ${handshake.modMajor} (${mod}) and this app (${appVersion}) speaks contract ${handshake.appMajor}. Update the mod.`;
    case "mod-major-newer":
      return `The mod speaks contract ${handshake.modMajor} (${mod}) and this app (${appVersion}) speaks contract ${handshake.appMajor}. Update this app.`;
    default:
      return null;
  }
}

/** The quiet note for a minor difference, or `null` when the minors agree or the major differs. */
export function describeMinorDifference(
  handshake: ModHandshake,
): string | null {
  if (handshake.kind === "mod-minor-newer") {
    return "The mod has a newer contract revision than this app. Update this app to use everything it offers.";
  }
  if (handshake.kind === "app-minor-newer") {
    return "This app has a newer contract revision than the mod. Update the mod to match.";
  }
  return null;
}
