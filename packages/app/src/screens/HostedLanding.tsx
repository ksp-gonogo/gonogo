import styled from "styled-components";

/**
 * Shown at "/" when the app is served over HTTPS, i.e. the published
 * GitHub Pages build. The main screen talks to the Gonogo mod's telemetry
 * stream over insecure ws://, which a secure-origin (HTTPS) page can't
 * reach (mixed content), so a hosted main screen can never connect. The published root
 * is a front door that points people at the local setup instead. Served
 * over http:// (the local container or the dev server), App renders the
 * real MainScreen.
 */
export function HostedLanding() {
  const stationHref = `${import.meta.env.BASE_URL}station`;
  return (
    <Wrap>
      <Hero>
        <Title>gonogo</Title>
        <Tagline>A mission control room for Kerbal Space Program.</Tagline>
        <Lede>
          Run your whole save from the browser: contracts, science, the
          administration building, launches, and live telemetry. Lay the widgets
          out the way you want, across as many screens as you want.
        </Lede>
        <Note role="note">
          The main screen connects directly to your KSP install, so it runs on
          your own machine, not here. This page is just the front door.
        </Note>
        <Actions>
          <Primary href="https://github.com/ksp-gonogo/gonogo#readme">
            Set up gonogo
          </Primary>
          <Secondary href={stationHref}>Open a station screen</Secondary>
        </Actions>
        <Fine>
          A station screen joins a main screen that is already running on
          someone's machine. All you need is the share code.
        </Fine>
      </Hero>
    </Wrap>
  );
}

const Wrap = styled.div`
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  background: var(--color-surface-app);
  color: var(--color-text-primary);
`;

const Hero = styled.main`
  max-width: 640px;
  text-align: center;
`;

const Title = styled.h1`
  margin: 0;
  font-size: clamp(3rem, 12vw, 5rem);
  font-weight: 800;
  letter-spacing: 0.02em;
  color: var(--color-accent-fg);
`;

const Tagline = styled.p`
  margin: 0.5rem 0 0;
  font-size: clamp(1.1rem, 3.5vw, 1.5rem);
  font-weight: 600;
  color: var(--color-text-primary);
`;

const Lede = styled.p`
  margin: 1.25rem auto 0;
  max-width: 54ch;
  font-size: 1.05rem;
  line-height: 1.55;
  color: var(--color-text-muted);
`;

const Note = styled.p`
  margin: 1.5rem auto 0;
  max-width: 50ch;
  font-size: 0.95rem;
  line-height: 1.5;
  color: var(--color-text-muted);
  border-left: 2px solid var(--color-accent-fg);
  padding-left: 0.9rem;
  text-align: left;
`;

const Actions = styled.div`
  margin-top: 2rem;
  display: flex;
  gap: 0.9rem;
  justify-content: center;
  flex-wrap: wrap;
`;

const linkReset = `
  display: inline-flex;
  align-items: center;
  text-decoration: none;
  border-radius: 6px;
  padding: 0.7rem 1.3rem;
  font-size: 1rem;
  font-weight: 600;
  transition: filter 0.15s, border-color 0.15s, color 0.15s;

  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

const Primary = styled.a`
  ${linkReset}
  background: var(--color-accent-bg);
  color: var(--color-text-inverse);

  @media (hover: hover) {
    &:hover {
      filter: brightness(1.1);
    }
  }
`;

const Secondary = styled.a`
  ${linkReset}
  background: transparent;
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-strong);

  @media (hover: hover) {
    &:hover {
      border-color: var(--color-accent-fg);
      color: var(--color-accent-fg);
    }
  }
`;

const Fine = styled.p`
  margin: 1.75rem auto 0;
  max-width: 48ch;
  font-size: 0.82rem;
  line-height: 1.5;
  color: var(--color-text-muted);
`;
