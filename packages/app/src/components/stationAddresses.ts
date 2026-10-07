/** The public build of the app, reachable from any network. */
export const PUBLIC_STATION_URL = "https://ksp-gonogo.github.io/app/station";

export interface StationAddress {
  id: "local" | "public";
  label: string;
  /** Which device this address is the right one for. */
  when: string;
  url: string;
}

export interface StationAddresses {
  addresses: StationAddress[];
  /** The address the QR code encodes: the one a phone can actually reach. */
  qr: StationAddress;
}

export interface StationAddressInput {
  code: string;
  /** `location.origin` of the page the operator is on. */
  origin: string;
  /** The app's base path, `/` for a self-hosted build. */
  baseUrl: string;
  /** `VITE_STATION_URL`: a fork's own deploy, which replaces every other address. */
  override?: string;
}

const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;
const LAN_ADDRESS = /^https?:\/\/\d+\.\d+\.\d+\.\d+(?::\d+)?$/;

function withHost(url: string, code: string): string {
  return `${url}?host=${encodeURIComponent(code)}`;
}

/**
 * The addresses a station can open to join this main screen.
 *
 * A station needs two things from its address: to load the app, and to be
 * reachable from where the station is. The page the operator is on serves the
 * app to whoever can reach it, so that origin is the address whenever it is
 * not a loopback or private one. On localhost or a LAN address a device on
 * another network cannot reach it, so the public build is offered beside it.
 * The QR encodes the one a phone can use: this app's own address on a LAN, the
 * public build when the page is on localhost.
 */
export function stationAddresses({
  code,
  origin,
  baseUrl,
  override,
}: StationAddressInput): StationAddresses {
  if (override) {
    const url = withHost(override.replace(/\/$/, ""), code);
    const only: StationAddress = {
      id: "public",
      label: "Station address",
      when: "For any device that can reach it",
      url,
    };
    return { addresses: [only], qr: only };
  }

  const own: StationAddress = {
    id: "local",
    label: "This app",
    when: "",
    url: withHost(`${origin}${baseUrl}station`, code),
  };
  const isLoopback = LOOPBACK.test(origin);
  if (!isLoopback && !LAN_ADDRESS.test(origin)) {
    own.when = "For any device that can reach this page";
    return { addresses: [own], qr: own };
  }

  const publicBuild: StationAddress = {
    id: "public",
    label: "Public build",
    when: "For a device on another network (needs internet)",
    url: withHost(PUBLIC_STATION_URL, code),
  };
  own.when = isLoopback
    ? "For another window on this computer"
    : "For a device on the same network";
  return {
    addresses: [own, publicBuild],
    qr: isLoopback ? publicBuild : own,
  };
}
