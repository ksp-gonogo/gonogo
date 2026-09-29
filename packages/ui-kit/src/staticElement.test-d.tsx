// Type-level proof, run by the package `typecheck`, that a layout primitive can hold content but never become a control.

import { Block } from "./Block";
import { Section } from "./Section";
import { Stack } from "./Stack";

export const Allowed = () => (
  <>
    <Stack as="ul" />
    <Section as="section" titleAs="h3" />
    <Block as="li" />
  </>
);

export const Refused = () => (
  <>
    {/* @ts-expect-error a Stack is never a button: a control belongs to the Button family */}
    <Stack as="button" />
    {/* @ts-expect-error a Stack is never a link */}
    <Stack as="a" />
    {/* @ts-expect-error a Section is never a form field */}
    <Section as="input" />
    {/* @ts-expect-error a Block's title is never a button */}
    <Block titleAs="button" />
  </>
);
