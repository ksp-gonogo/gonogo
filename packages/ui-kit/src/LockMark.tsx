import styled from "styled-components";
import { LockIcon } from "./Icons";
import type { LockSummary } from "./LockScope";
import { Tooltip } from "./Tooltip";

/**
 * Props for {@link LockMark}.
 *
 * @category Panel
 */
export interface LockMarkProps {
  lock: LockSummary;
}

/**
 * The compact form of a lock, for a tile too small for the full notice: a
 * padlock and the name of what is missing. The whole sentence is its tooltip
 * and its accessible name.
 *
 * @category Panel
 */
export function LockMark({ lock }: LockMarkProps) {
  const sentence =
    lock.hint === undefined ? lock.reason : `${lock.reason}. ${lock.hint}`;
  return (
    <Tooltip text={sentence} focusable>
      <LockMark__Body role="status" aria-label={sentence}>
        <LockIcon />
        <LockMark__Name>{missingNames(lock)}</LockMark__Name>
      </LockMark__Body>
    </Tooltip>
  );
}

/** The unlocks' own names, which is the part of the sentence worth the space in a tiny tile. */
function missingNames(lock: LockSummary): string {
  const names = [
    ...new Set(lock.locks.flatMap((l) => l.missing.map((m) => m.name))),
  ];
  return names.length > 0 ? names.join(", ") : lock.reason;
}

const LockMark__Body = styled.span`
  display: inline-flex;
  align-items: center;
  gap: var(--gap-figure-parts);
  max-width: 100%;
  min-width: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-caption);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
`;

const LockMark__Name = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;
