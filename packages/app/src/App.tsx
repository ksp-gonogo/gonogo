import { PeerHostProvider } from "./peer/PeerHostProvider";
import { HostedLanding } from "./screens/HostedLanding";
import { MainScreen } from "./screens/MainScreen";
import { StationScreen } from "./screens/StationScreen";
import "./styles/global.css";

export default function App() {
  // BASE_URL is "/" in dev and "/gonogo/" on GitHub Pages — strip it so the
  // /station match works in both environments.
  const base = import.meta.env.BASE_URL;
  const path = globalThis.location.pathname;
  const relative = path.startsWith(base) ? `/${path.slice(base.length)}` : path;
  const isStation = relative.startsWith("/station");

  if (isStation) return <StationScreen />;

  // The main screen reaches KSP's Telemachus over insecure ws://, which a
  // secure-origin (HTTPS) page can't do (mixed content) — so a hosted build
  // can never run the main screen. Over HTTPS, show the front-door landing
  // that points at local setup; over http:// (local container / dev) render
  // the real main screen. Stations are unaffected — they peer over wss.
  if (globalThis.location.protocol === "https:") return <HostedLanding />;

  return (
    <PeerHostProvider>
      <MainScreen />
    </PeerHostProvider>
  );
}
