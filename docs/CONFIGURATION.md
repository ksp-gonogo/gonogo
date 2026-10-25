# Container settings

The Gonogo container reads these settings when it starts. Set one by adding `-e NAME=value` to the run command in the [README](../README.md#host-it-yourself), before the image name, then remove the old container (`docker rm -f gonogo`) and run the command again. Every setting is optional.

| Setting | What it does | Default | Example |
| --- | --- | --- | --- |
| `KSP_HOST` | Where the KSP computer is, so the main screen finds the game and its camera feeds without asking | `host.docker.internal` in the README's command (KSP on this computer) | `-e KSP_HOST=<the KSP computer's address>` |
| `GONOGO_AUTO_PORT_FORWARD` | Asks your router to open the relay's port so friends on other networks can join, keeps it open while the container runs, and closes it when the container stops. The same setting is **Automatic port forwarding** in the app's Settings, under Relay, and in the setup; once you choose it in the app, the app's choice wins | Off | `-e GONOGO_AUTO_PORT_FORWARD=1` |
| `ENDPOINT_PORT` | The one port friends on other networks connect through, on UDP and TCP. Change both `-p 47100:47100` parts of the command to the same number, and forward that port instead | `47100` | `-e ENDPOINT_PORT=47200 -p 47200:47200/udp -p 47200:47200/tcp` |
| `LAN_IP` | This computer's address on your home network. Friends on your home network are given it, and a router that opens ports with UPnP sends them to it. The container cannot see it for itself | Found by `scripts/run-gonogo.sh` and `pnpm dev`; otherwise unset | `-e LAN_IP=<this computer's address>` |
| `ROUTER_IP` | The router automatic port forwarding asks, and the only one. The same setting is **Router address** in the app's Settings, under Relay, and in the setup; once you enter it in the app, the app's address wins | None: automatic port forwarding asks no router until it has an address | `-e ROUTER_IP=<the router's address>` |
| `PUBLIC_IP` | Your public internet address, given to friends on other networks. Set it only when the address found automatically is wrong, such as with more than one internet connection | Found automatically | `-e PUBLIC_IP=203.0.113.7` |
| `RELAY_APP_ORIGINS` | Other addresses the main screen is opened at that may use the relay, comma-separated, such as this computer's network address | The public site and this computer only | `-e RELAY_APP_ORIGINS=http://<this computer's address>:8080` |
| `AXIOM_TOKEN` | Sends the relay's own logs to Axiom while the main screen has analytics switched on | The image's own, when it was built with one | `-e AXIOM_TOKEN=<your token>` |
| `AXIOM_DATASET` | The Axiom dataset those logs go to | `gonogo` | `-e AXIOM_DATASET=my-gonogo` |

The networking guide, [docs/NETWORKING.md](NETWORKING.md), explains when a friend needs the port forwarded and what the Add station window says about it.
