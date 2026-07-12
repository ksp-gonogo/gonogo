import type { ElementType, HTMLAttributes, ReactNode } from "react";
import styled from "styled-components";

export interface RowProps extends HTMLAttributes<HTMLElement> {
  /** Rendered tag. Defaults to `li` (a `Row` typically sits in a plain `<ul>`). */
  as?: ElementType;
  children?: ReactNode;
}

/**
 * A single spaced-between list row: name on the left, badges/actions on the
 * right. Extracted from ScienceOfficer's `Row` (`styled.li`) — the shape
 * hand-rolled ten times across the built-in widgets.
 *
 * The truncating name child is exported alongside as `RowName` (also
 * reachable as `Row.Name`).
 */
function RowBase({ as, children, ...rest }: RowProps) {
  return (
    <Row__Root as={as ?? "li"} {...rest}>
      {children}
    </Row__Root>
  );
}

const Row__Root = styled.li`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  padding: 2px 0;
`;

/** Truncating name/label child for a `Row` — flexes to fill, ellipsises overflow. */
export const RowName = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
  color: var(--color-text-primary);
`;

export const Row = Object.assign(RowBase, { Name: RowName });
