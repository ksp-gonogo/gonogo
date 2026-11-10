// A full-page route rather than a widget, on the same page scale as the station's connect view: viewport-height layout and safe-area insets no page-scale primitive expresses.
import styled from "styled-components";

export const JoinLayout = styled.main`
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: calc(var(--inset-page) + env(safe-area-inset-top, 0px))
    calc(var(--inset-page) + env(safe-area-inset-right, 0px))
    calc(var(--inset-page) + env(safe-area-inset-bottom, 0px))
    calc(var(--inset-page) + env(safe-area-inset-left, 0px));
  background: var(--color-surface-app);
  color: var(--color-text-primary);
`;

export const JoinBox = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-page);
  width: 100%;
  max-width: 640px;

  /* Display tier, the page's own heading: the type scale stops at --font-size-lg, so this is set as a page-scale size. */
  h1 {
    margin: 0;
    font-size: 20px;
  }
`;

/* The code is what a person reads aloud or checks against the inviting screen, so it is set large, above the type scale's --font-size-lg ceiling. */
export const JoinCode = styled.code`
  font-size: 28px;
  letter-spacing: 0.15em;
  color: var(--color-info-text);
`;

export const JoinRow = styled.form`
  display: flex;
  align-items: stretch;
  gap: var(--gap-related);

  @media (max-width: 480px) {
    flex-direction: column;
  }
`;

export const JoinInput = styled.input`
  flex: 1 1 0;
  min-width: 0;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-text-faint);
  border-radius: var(--radius-regular);
  padding: var(--inset-control-prominent);
  /* Matches the heading's page-scale size, so a typed code reads like the one on the inviting screen. */
  font-size: 20px;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--color-info-text);

  &::placeholder {
    color: var(--color-text-faint);
    letter-spacing: normal;
    text-transform: none;
  }

  &:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }
`;

export const JoinMuted = styled.p`
  margin: 0;
  font-size: var(--font-size-prose);
  color: var(--color-text-muted);
`;
