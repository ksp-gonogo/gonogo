import { DomainAvailabilityProvider } from "@ksp-gonogo/ui-kit";
import { PeerHostProvider } from "./peer/PeerHostProvider";
import { HostedLanding } from "./screens/HostedLanding";
import { isStationRoute } from "./screens/isStationRoute";
import { MainScreen } from "./screens/MainScreen";
import { StationScreen } from "./screens/StationScreen";
import "./styles/fonts.css";
import "./styles/global.css";

export default function App() {
  // Owns the ui-kit domain-availability store both screens' AugmentSlots read;
  // each screen's telemetry-fed `AugmentAvailabilityFeeder` writes into it. The
  // store lives above the screen split so a route change never remounts it.
  return (
    <DomainAvailabilityProvider>
      <AppRoute />
    </DomainAvailabilityProvider>
  );
}

function AppRoute() {
  if (isStationRoute()) return <StationScreen />;

  // The main screen reaches KSP's Telemachus over insecure ws://, which a
  // secure-origin (HTTPS) page can't do (mixed content), so a hosted build
  // can never run the main screen. Over HTTPS, show the front-door landing
  // that points at local setup; over http:// (local container / dev) render
  // the real main screen. Stations are unaffected, they peer over wss.
  if (globalThis.location.protocol === "https:") return <HostedLanding />;

  return (
    <PeerHostProvider>
      <MainScreen />
    </PeerHostProvider>
  );
}
