// An integrity failure: the loader found an artifact whose hash disagrees with
// what something else said that hash would be.
//
// Every other refusal in the loader is a disappointment. A compat gate, a
// missing bundle, a dead network: each says an Uplink will not run here, and
// the operator loses a widget. This one says the bytes are not the bytes that
// were vouched for, which is tampering, a wrong URL, or a stale CDN, and it is
// the most serious thing the loader can discover.
//
// So it is recorded as a VALUE, not only spelled into a reason string. A
// surface that must tell a security event from an ordinary miss cannot do it by
// matching prose, and the reason strings are already load-bearing as the
// diagnostic line. `UplinkLoadOutcome.integrity` carries this record, and every
// surface that renders it gets the same finding, the same two hashes and the
// same named parties.

/**
 * Who vouched a hash. The distinction is the point of the whole record: the Hub
 * index is a published catalogue entry describing a bundle, and the installed
 * mod is the thing the operator chose to install from CKAN. A bundle
 * disagreeing with the first is a broken release; disagreeing with the second
 * is the bytes not being the ones the operator's own mod stands behind.
 */
export type UplinkIntegrityParty = "installed-mod" | "hub-index";

/** Which artifact carried the hash that turned out to be wrong. */
export type UplinkIntegritySubject = "bundle" | "manifest";

/** One integrity failure: what was checked, the two hashes, and who vouched. */
export interface UplinkIntegrityFailure {
  subject: UplinkIntegritySubject;
  /** The hash the loader computed from, or read out of, the artifact. */
  observed: string;
  /** The hash that artifact was checked against. */
  expected: string;
  /**
   * Every party that vouched `expected`, most significant first. Never empty,
   * and more than one where the mod and the Hub index agreed on a hash the
   * bytes then failed to match.
   *
   * More than one is the COMMON case and the reason this is a list rather than
   * a single value. `checkCompat` refuses before the fetch whenever the mod's
   * vouched hash differs from the index's, so by the time bytes are hashed the
   * two agree, and a mismatch is the bundle disagreeing with BOTH at once. A
   * record naming only the index would read as a broken release when what
   * actually happened is that the bytes are not the ones the installed mod
   * stands behind.
   */
  vouchedBy: UplinkIntegrityParty[];
}

/** One side of a comparison, ready to render as a labelled hash. */
export interface UplinkIntegritySide {
  label: string;
  hash: string;
}

/** An integrity failure in the words an operator reads. */
export interface UplinkIntegrityReading {
  /** What was found, as a sentence. */
  finding: string;
  observed: UplinkIntegritySide;
  expected: UplinkIntegritySide;
}

const PARTY_LABEL: Record<UplinkIntegrityParty, string> = {
  "installed-mod": "installed mod",
  "hub-index": "Hub index",
};

const SUBJECT_LABEL: Record<UplinkIntegritySubject, string> = {
  bundle: "bundle bytes",
  manifest: "bundle manifest",
};

function joinParties(parties: readonly UplinkIntegrityParty[]): string {
  const labels = parties.map((party) => `the ${PARTY_LABEL[party]}`);
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

function finding(failure: UplinkIntegrityFailure): string {
  const parties = joinParties(failure.vouchedBy);
  if (failure.subject === "manifest") {
    return `The bundle's own manifest declares a different client from the one ${parties} named`;
  }
  return `The bundle served at this URL is not the one ${parties} named`;
}

/** The finding sentence and both labelled hashes, for a render surface. */
export function readIntegrityFailure(
  failure: UplinkIntegrityFailure,
): UplinkIntegrityReading {
  return {
    finding: finding(failure),
    observed: {
      label: SUBJECT_LABEL[failure.subject],
      hash: failure.observed,
    },
    expected: {
      label: failure.vouchedBy.map((p) => PARTY_LABEL[p]).join(" and "),
      hash: failure.expected,
    },
  };
}
