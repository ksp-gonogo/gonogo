import { installActGateStretch } from "./src/testing/install-act-gate-stretch";

// Inert unless the act-warning gate sets its variable. It sits outside `src` so the
// published package does not carry it.
await installActGateStretch();
