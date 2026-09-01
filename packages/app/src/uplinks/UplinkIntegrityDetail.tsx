import { Stack, Text } from "@ksp-gonogo/ui-kit";
import styled from "styled-components";
import { readIntegrityFailure, type UplinkIntegrityFailure } from "./integrity";

/**
 * A sha256 digest is 71 unbroken characters, so it needs somewhere to break and
 * a form that reads as a value rather than prose. No kit primitive renders a
 * raw digest, and letting it overflow would push the two hashes an operator is
 * meant to COMPARE off opposite edges of the screen.
 */
const HashLine = styled.span`
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  overflow-wrap: anywhere;
`;

/**
 * One integrity failure: what disagreed, and both hashes with the party each
 * came from.
 *
 * The labels are the reading. "Hub index" and "installed mod" are different
 * claims and collapsing them into one word would lose the distinction that
 * matters most: a bundle disagreeing with its own published descriptor is a
 * broken release, and a bundle disagreeing with the mod the operator installed
 * from CKAN is the bytes not being the ones that were vouched for.
 *
 * Shared by the top-of-screen banner and the Settings loaded-clients row so the
 * two can never drift into describing the same finding differently.
 */
export function UplinkIntegrityDetail({
  failure,
}: Readonly<{ failure: UplinkIntegrityFailure }>) {
  const reading = readIntegrityFailure(failure);
  return (
    <Stack gap="xs">
      <Text tone="nogo" size="sm">
        {reading.finding}
      </Text>
      <HashLine>
        {reading.observed.label}: {reading.observed.hash}
      </HashLine>
      <HashLine>
        {reading.expected.label}: {reading.expected.hash}
      </HashLine>
    </Stack>
  );
}
