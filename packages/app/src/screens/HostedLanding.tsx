import styled from "styled-components";

/**
 * Shown at "/" when the app is served over HTTPS — i.e. the published
 * GitHub Pages build. The main screen talks to KSP's Telemachus over
 * insecure `ws://`, which a secure-origin (HTTPS) page is not allowed to
 * reach (mixed content), so a hosted main screen can never actually
 * connect. Instead the published root is a front door that points people
 * at the local setup. Served over `http://` (the local container or
 * `pnpm dev`), `App` renders the real `MainScreen`.
 *
 * First pass: intent + a setup link + a way into a station screen. The
 * copy and visuals are a starting point, meant to be iterated.
 */
export function HostedLanding() {
  const stationHref = `${import.meta.env.BASE_URL}station`;
  return (
    <Wrap>
      <Hero>
        <Title>gonogo</Title>
        <Tagline>Mission control for Kerbal Space Program.</Tagline>
        <Lede>
          A live, multi-screen telemetry dashboard for your KSP flights —
          self-registering widgets that adapt to any screen, driven straight
          from your game.
        </Lede>
        <Note role="note">
          The main screen connects directly to your KSP install, so it runs on
          your own machine — not here. This page is just the front door.
        </Note>
        <Actions>
          <Primary href="https://github.com/jonpepler/gonogo#readme">
            Set up gonogo&nbsp;→
          </Primary>
          <Secondary href={stationHref}>Open a station screen</Secondary>
        </Actions>
        <Fine>
          A station screen joins a main screen that&rsquo;s already running on
          someone&rsquo;s machine — pair it with that machine&rsquo;s share
          code.
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
  background:
    radial-gradient(
      120% 80% at 50% -10%,
      rgba(0, 255, 136, 0.08),
      transparent 60%
    ),
    #0a0d10;
  color: #e6edf3;
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
  color: #00ff88;
  text-shadow: 0 0 24px rgba(0, 255, 136, 0.25);
`;

const Tagline = styled.p`
  margin: 0.5rem 0 0;
  font-size: clamp(1.1rem, 3.5vw, 1.5rem);
  font-weight: 600;
  color: #e6edf3;
`;

const Lede = styled.p`
  margin: 1.25rem auto 0;
  max-width: 52ch;
  font-size: 1.05rem;
  line-height: 1.55;
  color: #aab4bf;
`;

const Note = styled.p`
  margin: 1.5rem auto 0;
  max-width: 50ch;
  font-size: 0.95rem;
  line-height: 1.5;
  color: #8a96a3;
  border-left: 2px solid rgba(0, 255, 136, 0.4);
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
  transition: background 0.15s, border-color 0.15s, color 0.15s;

  &:focus-visible {
    outline: 2px solid #00ff88;
    outline-offset: 2px;
  }
`;

const Primary = styled.a`
  ${linkReset}
  background: #00ff88;
  color: #06120c;

  @media (hover: hover) {
    &:hover {
      background: #33ffa0;
    }
  }
`;

const Secondary = styled.a`
  ${linkReset}
  background: transparent;
  color: #e6edf3;
  border: 1px solid rgba(230, 237, 243, 0.3);

  @media (hover: hover) {
    &:hover {
      border-color: #00ff88;
      color: #00ff88;
    }
  }
`;

const Fine = styled.p`
  margin: 1.75rem auto 0;
  max-width: 48ch;
  font-size: 0.82rem;
  line-height: 1.5;
  /* Keep >=4.5:1 on the near-black background (AA, small text). */
  color: #8893a0;
`;
