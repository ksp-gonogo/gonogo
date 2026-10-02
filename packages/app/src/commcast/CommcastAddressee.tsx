import type { Value } from "@ksp-gonogo/sitrep-sdk";
import { speakQuantity, useTooltip, VisuallyHidden } from "@ksp-gonogo/ui-kit";
import { Fragment } from "react";
import styled from "styled-components";
import type { AddressBook } from "./CommcastContext";
import type { RecipientId } from "./types";

const Addressee__Gone = styled.span`
  color: var(--color-text-faint);
`;

/** What the tooltip and the accessible name say about an unreachable addressee; an absent stamp is unknown, never a time. */
function unreachableText(lastReachable: Value<"ut"> | undefined): string {
  const when =
    lastReachable === undefined ? "unknown" : speakQuantity(lastReachable);
  return `Unreachable, last reachable ${when}`;
}

/** One addressee by name; greyed, with when it was last reachable, once it has left the roster. */
export function Addressee({
  id,
  book,
}: {
  id: RecipientId;
  book: AddressBook;
}) {
  const gone = book.unreachableOf(id);
  const text = gone ? unreachableText(gone.lastReachable) : null;
  const { anchor, tip } = useTooltip(text);
  const name = book.nameFor(id);
  if (!gone) return <>{name}</>;
  return (
    <Addressee__Gone {...anchor}>
      {name}
      <VisuallyHidden>, {text}</VisuallyHidden>
      {tip}
    </Addressee__Gone>
  );
}

/** A list of addressees as the operator reads it: their names, alphabetically. */
export function Addressees({
  ids,
  book,
}: {
  ids: readonly RecipientId[];
  book: AddressBook;
}) {
  const sorted = [...ids].sort((a, b) =>
    book.nameFor(a).localeCompare(book.nameFor(b)),
  );
  return (
    <>
      {sorted.map((id, i) => (
        <Fragment key={id}>
          {i > 0 && ", "}
          <Addressee id={id} book={book} />
        </Fragment>
      ))}
    </>
  );
}
