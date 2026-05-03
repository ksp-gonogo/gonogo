# @gonogo/replay-server

Drop-in Telemachus replacement that serves a recorded `FlightFixture` over the
same wire format. Run alongside `pnpm dev` to exercise the whole gonogo app
against captured telemetry without launching KSP.

## Usage

```bash
# From the repo root
pnpm replay path/to/flight.fixture.json

# Or from this package
pnpm dev path/to/flight.fixture.json   # tsx watch — restarts on edits
pnpm start path/to/flight.fixture.json  # one-shot
```

By default the server listens on port `8085` (matching Telemachus). The app's
default Telemachus host (`http://localhost:8085`) connects to it without any
config change.

### Environment

| Variable  | Default     | Meaning                                       |
| --------- | ----------- | --------------------------------------------- |
| `PORT`    | `8085`      | Listen port                                   |
| `HOST`    | `0.0.0.0`   | Bind address                                  |
| `RATE`    | `1`         | Wall-clock playback rate (1 = real time, 10 = 10×) |
| `TICK_MS` | `250`       | Replay tick interval (matches Telemachus default) |

### Endpoints

- `GET ws://HOST:PORT/datalink` — WebSocket. Speaks the Telemachus wire
  protocol: `{"+":["v.altitude"], "rate": 250}` to subscribe,
  `{"-":["v.altitude"]}` to unsubscribe, server pushes `{key: value}` updates.
- `GET http://HOST:PORT/telemachus/datalink?a=<actionKey>` — execute. Records
  into the replay's `executeLog` instead of dispatching to a real game.
- `GET http://HOST:PORT/replay/info` — fixture metadata + current playback
  position. Useful for a future seek-bar UI.

## Capturing a fixture

In the running app, open the History FAB → "↓ fixture" on any flight row.
The browser downloads a `.fixture.json` file. Drop that path into the replay
binary and the same telemetry plays back.

## Architecture

`TelemachusReplayService` handles per-connection wire-format translation
(decoupled from Fastify so it's unit-testable with no real WebSocket).
`createReplayServer` wires one shared `FlightReplayDataSource` to N
connections via `@fastify/websocket`. The CLI (`src/index.ts`) is a thin
process entry that loads the fixture and binds the server.
