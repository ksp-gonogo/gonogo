import {
  Children,
  isValidElement,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { Tooltip } from "./Tooltip";

/** The words a button's children show: its strings and numbers, through any element around them. An icon has none. */
export function visibleText(children: ReactNode): string {
  let text = "";
  Children.forEach(children, (child) => {
    if (typeof child === "string" || typeof child === "number") {
      text += String(child);
      return;
    }
    if (isValidElement<{ children?: ReactNode }>(child)) {
      text += visibleText(child.props.children);
    }
  });
  return text.replace(/\s+/g, " ").trim();
}

/**
 * What a button says in its tip, or `null` for none. A button that is a glyph
 * alone, or whose accessible name says more than its words do, tips its name;
 * a button whose words are the whole story tips nothing. A disabled button
 * given a reason tips the reason after its name, when it has one to add.
 */
export function buttonTipText({
  label,
  children,
  disabledReason,
}: {
  label: string | undefined;
  children: ReactNode;
  disabledReason: string | undefined;
}): string | null {
  return nameAndReason({ label, children, disabledReason });
}

function nameAndReason({
  label,
  children,
  disabledReason,
}: {
  label: string | undefined;
  children: ReactNode;
  disabledReason: string | undefined;
}): string | null {
  const name =
    label !== undefined && label !== "" && label !== visibleText(children)
      ? label
      : null;
  if (disabledReason !== undefined && disabledReason !== "") {
    return name === null ? disabledReason : `${name}: ${disabledReason}`;
  }
  return name;
}

/**
 * A button with `disabledReason` and `disabled` is `aria-disabled` rather than
 * natively disabled, so it keeps keyboard focus and the pointer events its tip
 * needs; its presses do nothing.
 */
export function reasonedDisabled(
  disabled: boolean | undefined,
  disabledReason: string | undefined,
): boolean {
  return (
    disabled === true && disabledReason !== undefined && disabledReason !== ""
  );
}

/** A press on a button disabled with a reason is swallowed, and submits no form. */
export function swallowPress(event: MouseEvent<HTMLButtonElement>): void {
  event.preventDefault();
  event.stopPropagation();
}

/**
 * Wraps a button element in the tip it owes under {@link buttonTipText}, unless
 * an enclosing {@link Tooltip} has already handed it one (`data-tooltip`).
 */
export function withButtonTip(
  body: ReactElement<Record<string, unknown>>,
  tip: string | null,
  announce: boolean,
): ReactElement {
  if (tip === null || body.props["data-tooltip"] !== undefined) return body;
  return (
    <Tooltip text={tip} announce={announce}>
      {body}
    </Tooltip>
  );
}
