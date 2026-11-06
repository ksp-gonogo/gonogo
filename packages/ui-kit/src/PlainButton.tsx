import { forwardRef } from "react";
import styled from "styled-components";
import type { PlainButtonProps } from "./Button";
import { Button__Body } from "./ButtonBody";
import {
  buttonTipText,
  reasonedDisabled,
  swallowPress,
  withButtonTip,
} from "./buttonTip";
import { HeldFigure } from "./HeldMark";

/*
 * The held mark hangs off the button's corner and reserves no room, so a marked
 * button is the size of the same button unmarked and its label stays centred.
 */
const Button__Held = styled(HeldFigure)`
  position: static;

  &::after {
    content: none;
  }

  & > [data-held-mark] {
    top: 3px;
    right: 3px;
  }
`;

/**
 * The plain button: the kit's {@link Button} with no command. {@link Button}
 * draws this unless it is given a `command`, and a toggle given a command draws
 * it too.
 */
export const PlainButton = forwardRef<HTMLButtonElement, PlainButtonProps>(
  function Button(
    {
      variant = "default",
      tone,
      size = "md",
      pressed,
      predictedOutcome,
      disabledReason,
      marked,
      type = "button",
      ...rest
    },
    ref,
  ) {
    const reasoned = reasonedDisabled(rest.disabled, disabledReason);
    const tip = buttonTipText({
      label: rest["aria-label"],
      children: rest.children,
      disabledReason: reasoned ? disabledReason : undefined,
    });
    const { disabled, onClick, children, ...passed } = rest;
    return withButtonTip(
      <Button__Body
        ref={ref}
        $variant={variant}
        $tone={tone ?? (variant === "primary" ? "go" : "neutral")}
        $size={size}
        $pressed={pressed === true}
        aria-pressed={pressed}
        data-predicted={predictedOutcome}
        data-held-button={marked ? "" : undefined}
        {...passed}
        disabled={reasoned ? undefined : disabled}
        {...(reasoned ? { "aria-disabled": true } : {})}
        onClick={reasoned ? swallowPress : onClick}
        // After the caller's own props, so a button that passed a type keeps the attribute where it always sat.
        type={type}
      >
        {marked ? (
          <Button__Held kind={marked.kind} caption={marked.caption}>
            {children}
          </Button__Held>
        ) : (
          children
        )}
      </Button__Body>,
      tip,
      reasoned,
    );
  },
);
