import { forwardRef, type InputHTMLAttributes } from "react";
import styled from "styled-components";
import { focusRing } from "./focusRing";

/**
 * A native range input's attributes, less the `type`, which a slider always
 * is.
 *
 * @category Form
 */
export type SliderProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

/**
 * A native range slider in the kit's accent, for a value set by feel along a
 * fixed span (a throttle, a gain). It fills the width it is given; the value
 * it stands for is the caller's to show beside it.
 *
 * @category Form
 */
export const Slider = forwardRef<HTMLInputElement, SliderProps>(
  function Slider(props, ref) {
    return <Slider__Input ref={ref} type="range" {...props} />;
  },
);

const Slider__Input = styled.input`
  width: 100%;
  min-width: 0;
  margin: 0;
  background: none;
  accent-color: var(--color-accent-fg);
  cursor: pointer;

  ${focusRing}

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;
