import { CommandBlock } from "@ksp-gonogo/ui";
import styled from "styled-components";
import {
  CKAN_UPLINK_FILTER,
  LOCAL_APP_URL,
  RUN_COMMAND,
  SETUP_LINKS,
} from "../firstRun/setupGuide";

/**
 * Shown at "/" when the app is served over HTTPS, i.e. the published
 * GitHub Pages build. The main screen talks to the Gonogo mod's telemetry
 * stream over insecure ws://, which a secure-origin (HTTPS) page can't
 * reach (mixed content), so a hosted main screen can never connect. The published root
 * is a front door that points people at the local setup instead. Served
 * over http:// (the local container or the dev server), App renders the
 * real MainScreen.
 *
 * It carries the half of the setup that has to happen before a local app
 * exists: start the container, install the mod. Nothing here checks anything,
 * for the same mixed-content reason, so every check waits for the setup that
 * opens in the local app. `docs/homepage/index.html` is the same page as
 * static HTML for the organisation root; keep the two saying the same thing.
 */
export function HostedLanding() {
  const stationHref = `${import.meta.env.BASE_URL}station`;
  return (
    <Wrap>
      <Hero>
        <Header>
          <Title>gonogo</Title>
          <Tagline>A mission control room for Kerbal Space Program.</Tagline>
          <Lede>
            Run your whole save from the browser: contracts, science, the
            administration building, launches, and live telemetry. Lay the
            widgets out the way you want, across as many screens as you want.
          </Lede>
        </Header>

        <SetupTitle>Set it up</SetupTitle>
        <Intro>
          Gonogo runs on your own computer, not on this website, because it
          talks to your copy of KSP over your own network. Three steps get it
          going.
        </Intro>

        <Steps>
          <Step>
            <StepTitle>Start Gonogo on your computer</StepTitle>
            <StepText>
              Gonogo comes as a container. If you do not have Docker yet,{" "}
              <a href={SETUP_LINKS.docker}>install Docker</a> and start it. Then
              run this in a terminal:
            </StepText>
            <CommandBlock command={RUN_COMMAND} label="run command" />
            <StepText>
              It is one line, so it pastes into any terminal. With Podman, type{" "}
              <code>podman</code> in place of <code>docker</code>.
            </StepText>
          </Step>
          <Step>
            <StepTitle>Install the Gonogo mod in KSP</StepTitle>
            <StepText>
              Gonogo reads the game through a mod. The easiest way to install
              mods is CKAN, a mod manager for KSP:{" "}
              <a href={SETUP_LINKS.ckanInstall}>install CKAN</a> by following
              its own guide, then search it for <code>Gonogo</code> and install
              it.
            </StepText>
            <StepText>
              Uplinks are optional add-ons that connect Gonogo to other mods,
              adding things like camera feeds, a scripting terminal or surface
              maps. Gonogo works without any. To list them, type this into the
              search box in CKAN:
            </StepText>
            <CommandBlock command={CKAN_UPLINK_FILTER} label="CKAN search" />
            <StepText>
              If CKAN does not list Gonogo yet, the{" "}
              <a href={SETUP_LINKS.kspSetup}>KSP setup guide</a> shows how to
              install it by hand.
            </StepText>
          </Step>
          <Step>
            <StepTitle>Open the app and follow the setup</StepTitle>
            <StepText>
              Start KSP, then open <a href={LOCAL_APP_URL}>{LOCAL_APP_URL}</a>{" "}
              on the computer you ran the command on. A short setup opens by
              itself and checks each part for you: the container, the connection
              to KSP, and any Uplinks. If KSP is on a different computer, it
              asks for that computer's address. The rest of the instructions are
              there.
            </StepText>
          </Step>
        </Steps>

        <Fine>
          Joining a game someone else is running? You need none of the above:{" "}
          <a href={stationHref}>open a station screen</a> and enter their share
          code. Source and releases are on{" "}
          <a href={SETUP_LINKS.source}>GitHub</a>, and the{" "}
          <a href={SETUP_LINKS.uplinkDocs}>Uplink developer docs</a> cover
          building an Uplink of your own.
        </Fine>
      </Hero>
    </Wrap>
  );
}

/*
 * The rem sizes throughout this file stay off the px token scales on
 * purpose. This is a pre-login, full-page route that deliberately scales
 * with the browser's root font size; converting it to px tokens would be an
 * accessibility regression, not a cleanup. The unitless line-heights and the
 * 6px radius are on the scales, since neither is root-relative.
 */
const Wrap = styled.div`
  min-height: 100vh;
  display: flex;
  justify-content: center;
  padding: 3rem 1.25rem;
  background: var(--color-surface-app);
  color: var(--color-text-primary);

  a {
    color: var(--color-accent-fg);
  }

  a:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

const Hero = styled.main`
  width: 100%;
  max-width: 680px;
`;

const Header = styled.header`
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
  line-height: var(--line-height-prose);
  color: var(--color-text-muted);
`;

const SetupTitle = styled.h2`
  margin: 2.75rem 0 0;
  font-size: 1.25rem;
  font-weight: 700;
`;

const Intro = styled.p`
  margin: 0.5rem 0 0;
  line-height: var(--line-height-prose);
  color: var(--color-text-muted);
`;

const Steps = styled.ol`
  list-style: none;
  margin: 1.25rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  counter-reset: step;
`;

const Step = styled.li`
  counter-increment: step;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 1.1rem 1.2rem;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-floating);
`;

const StepTitle = styled.h3`
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;

  &::before {
    content: counter(step) ". ";
    color: var(--color-accent-fg);
  }
`;

const StepText = styled.p`
  margin: 0;
  font-size: 0.97rem;
  line-height: var(--line-height-prose);
  color: var(--color-text-muted);

  code {
    font-family: var(--font-family-mono);
    color: var(--color-text-primary);
  }
`;

const Fine = styled.p`
  margin: 2rem 0 0;
  font-size: 0.9rem;
  line-height: var(--line-height-prose);
  color: var(--color-text-muted);
`;
