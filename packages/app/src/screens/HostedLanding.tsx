import { CommandBlock } from "@ksp-gonogo/ui";
import styled from "styled-components";
import { say } from "../firstRun/copy";
import {
  browserShell,
  CKAN_UPLINK_FILTER,
  CONTAINER_NAME,
  imageTagOf,
  LOCAL_APP_URL,
  runCommandFor,
  SETUP_LINKS,
  spacedockPage,
  UPDATE_REMOVE_COMMAND,
} from "../firstRun/setupGuide";
import { VERSION } from "../version";

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
  const shell = browserShell();
  const spacedock = spacedockPage(import.meta.env.VITE_SPACEDOCK_MOD_ID);
  return (
    <Wrap>
      <Hero>
        <Header>
          <Title>gonogo</Title>
          <Tagline>Mission control for Kerbal Space Program.</Tagline>
          <Lede>
            Get rich telemetry from the API, or use the mission control app that
            supports multiplayer-focused station screens. Expansive mod support
            provided through the Uplink framework.
          </Lede>
        </Header>

        <Join>
          <a href={stationHref}>Join someone else&apos;s game</a>
        </Join>

        <SetupTitle>Set it up</SetupTitle>

        <Steps>
          <Step>
            <details>
              <Summary>
                <Num>1</Num>
                <What>Install the Gonogo mod in KSP</What>
              </Summary>
              <StepBody>
                <StepText>
                  Search for Gonogo in{" "}
                  <a href={SETUP_LINKS.ckanInstall}>CKAN</a>, or download and
                  install manually from{" "}
                  {spacedock && (
                    <>
                      <a href={spacedock}>SpaceDock</a> or{" "}
                    </>
                  )}
                  the{" "}
                  <a href={`${SETUP_LINKS.source}/releases`}>
                    GitHub Releases page
                  </a>{" "}
                  (<a href={SETUP_LINKS.kspSetup}>setup guide</a>).
                </StepText>
                <StepText>
                  Optionally, install Uplinks. Uplinks are mods in their own
                  right. They extend Gonogo, typically to support other mods. In
                  CKAN you can discover them by searching &quot;
                  {CKAN_UPLINK_FILTER}&quot;.
                </StepText>
                <CommandBlock
                  command={CKAN_UPLINK_FILTER}
                  label="CKAN search"
                />
              </StepBody>
            </details>
          </Step>
          <Step>
            <details>
              <Summary>
                <Num>2</Num>
                <What>Start Gonogo on your computer</What>
              </Summary>
              <StepBody>
                <StepText>
                  Use <a href={SETUP_LINKS.dockerSite}>Docker</a> or another
                  container runtime, like{" "}
                  <a href={SETUP_LINKS.podmanSite}>Podman</a>. It&apos;s easiest
                  to do this on a different computer to the one running KSP. If
                  you&apos;re using the same computer, ensure KSP&apos;s
                  background simulation setting is on.
                </StepText>
                <StepText>In a terminal, run:</StepText>
                <CommandBlock
                  command={runCommandFor(shell, imageTagOf(VERSION))}
                  label="run command"
                />
                <Notes>
                  <li>
                    Name <code>{CONTAINER_NAME}</code> already in use? Run{" "}
                    <code>{UPDATE_REMOVE_COMMAND}</code>, then the command
                    again.
                  </li>
                  {shell === "powershell" && (
                    <li>{say("container.powershellNote")}</li>
                  )}
                  <li>
                    If playing with friends on the Internet, see the{" "}
                    <a href={SETUP_LINKS.relayPorts}>networking guide</a>.
                  </li>
                </Notes>
              </StepBody>
            </details>
          </Step>
          <Step>
            <details>
              <Summary>
                <Num>3</Num>
                <What>Open the app and follow the setup</What>
              </Summary>
              <StepBody>
                <StepText>
                  Start KSP, then open{" "}
                  <a href={LOCAL_APP_URL}>{LOCAL_APP_URL}</a> on the computer
                  Gonogo is running on.
                </StepText>
                <Notes>
                  <li>
                    Keep the Gonogo tab open. Other screens get their data
                    through it.
                  </li>
                </Notes>
              </StepBody>
            </details>
          </Step>
        </Steps>

        <Fine>
          <a href={SETUP_LINKS.source}>GitHub</a> ·{" "}
          <a href={SETUP_LINKS.uplinkDocs}>Uplink developer docs</a> ·{" "}
          <a href={SETUP_LINKS.apiDocs}>API docs</a>
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
  margin: 2.5rem 0 0.8rem;
  font-size: 1.25rem;
  font-weight: 700;
`;

const Steps = styled.ol`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
`;

const Step = styled.li`
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-floating);

  code {
    font-family: var(--font-family-mono);
    color: var(--color-text-primary);
  }
`;

const Summary = styled.summary`
  list-style: none;
  cursor: pointer;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  column-gap: 0.8rem;
  padding: 0.8rem 1rem;
  border-radius: var(--radius-floating);

  &::-webkit-details-marker {
    display: none;
  }

  &::after {
    content: "";
    grid-column: 3;
    width: 0.55rem;
    height: 0.55rem;
    border-right: 2px solid var(--color-text-muted);
    border-bottom: 2px solid var(--color-text-muted);
    transform: rotate(45deg) translate(-2px, -2px);
  }

  details[open] > &::after {
    transform: rotate(225deg) translate(-2px, -2px);
  }

  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

const Num = styled.span`
  display: grid;
  place-items: center;
  width: 1.8rem;
  height: 1.8rem;
  border-radius: var(--radius-circle);
  border: 1px solid var(--color-accent-fg);
  color: var(--color-accent-fg);
  font-weight: 700;
  font-size: 0.9rem;
`;

const What = styled.span`
  grid-column: 2;
  font-size: 1.05rem;
  font-weight: 700;
`;

const StepBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0 1rem 1rem 3.6rem;

  @media (max-width: 520px) {
    padding-left: 1rem;
  }
`;

const StepText = styled.p`
  margin: 0;
  font-size: 0.95rem;
  line-height: var(--line-height-prose);
  color: var(--color-text-muted);
`;

const Notes = styled.ul`
  margin: 0;
  padding-left: 1.1rem;
  font-size: 0.9rem;
  line-height: var(--line-height-prose);
  color: var(--color-text-muted);

  li + li {
    margin-top: 0.25rem;
  }
`;

const Join = styled.p`
  margin: 1.5rem 0 0;
  font-size: 1rem;
  font-weight: 700;
`;

const Fine = styled.footer`
  margin: 2rem 0 0;
  font-size: 0.9rem;
  line-height: var(--line-height-prose);
  color: var(--color-text-muted);
`;
