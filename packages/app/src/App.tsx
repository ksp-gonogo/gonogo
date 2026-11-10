import { DomainAvailabilityProvider } from "@ksp-gonogo/ui-kit";
import { InjectedRadioBackend } from "./commcast/radio/InjectedRadioBackend";
import { HostedLanding } from "./screens/HostedLanding";
import { JoinPage } from "./screens/JoinPage";
import { LocalScreen } from "./screens/LocalScreen";
import { currentRoute } from "./screens/route";
import "./styles/fonts.css";
import "./styles/global.css";

export default function App() {
  // Owns the ui-kit domain-availability store both screens' AugmentSlots read;
  // each screen's telemetry-fed `AugmentAvailabilityFeeder` writes into it. The
  // store lives above the screen split so a route change never remounts it.
  return (
    <DomainAvailabilityProvider>
      {/* Above the route split, because every screen carries a radio and the
          backend must not change identity when the route does. */}
      <InjectedRadioBackend>
        <AppRoute />
      </InjectedRadioBackend>
    </DomainAvailabilityProvider>
  );
}

function AppRoute() {
  if (currentRoute() === "join") return <JoinPage />;

  /*
   * A local screen reaches the Gonogo mod over insecure ws://, which a page
   * served over HTTPS cannot open to another machine. The hosted build's front
   * door says so and points at local setup, and anyone joining a game there
   * does it through the join page and is fed through the host.
   */
  if (globalThis.location.protocol === "https:") return <HostedLanding />;

  return <LocalScreen />;
}
