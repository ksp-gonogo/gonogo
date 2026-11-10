/** The public release build of the app, reachable from any network. */
export const PUBLIC_APP_URL = "https://ksp-gonogo.github.io/app/";

/** The public release-candidate build of the app, reachable from any network. */
export const PUBLIC_RC_APP_URL = "https://ksp-gonogo.github.io/rc/";

/** The channel a build is published to: `app` is the release, `rc` the candidate. */
export type Channel = "app" | "rc";

export interface InviteAddressInput {
  code: string;
  /** `location.origin` of the page the invite is shown on. */
  origin: string;
  /** The app's base path, `/` for a self-hosted build. */
  baseUrl: string;
  /** The channel this build was published to. */
  channel: Channel;
  /** `VITE_APP_URL`: a fork's own public deploy of the app, used in place of every other address. */
  override?: string;
}

const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;

/**
 * The one address that joins this game: the join page under `code`. It is the
 * app this page was served from, which any device that can reach this page
 * can open, except on a loopback address no other device can reach, where it
 * is the public build of this channel instead.
 */
export function inviteAddress({
  code,
  origin,
  baseUrl,
  channel,
  override,
}: InviteAddressInput): string {
  const app = override
    ? `${override.replace(/\/$/, "")}/`
    : LOOPBACK.test(origin)
      ? channel === "rc"
        ? PUBLIC_RC_APP_URL
        : PUBLIC_APP_URL
      : `${origin}${baseUrl}`;
  return `${app}join?${encodeURIComponent(code)}`;
}
