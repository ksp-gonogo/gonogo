// MechJeb Uplink client for gonogo.
//
// Co-located with the GonogoMechJebUplink C# mod (mod/GonogoMechJebUplink):
// one directory holds the mod and the client TS it ships.
// Importing this package's entry point side-effects the widget
// registration into @ksp-gonogo/core's global component registry:
//
//   - `uplink.ts` -> defineUplinkClient({ id: "mechjeb", ... }) declares this
//     client's identity; the MechJeb
//     widget registration below stamps the returned MECHJEB handle as
//     `owner`, so the widget picker's mod search tags derive "mechjeb"
//     automatically.
//   - `MechJeb` component -> registerComponent({ id: "mechjeb", ... }) so it
//     is placeable from the dashboard widget picker. A delayed-command
//     CONTROL surface (engage ascent, execute next node, land at target)
//     dispatched over the app's command layer, gated on the signal delay;
//     MechJeb's own readouts are derivable, so there is no telemetry read
//     side beyond the comms.delay subtitle.
//
// To wire it into the app: `import "@ksp-gonogo/gonogo-mechjeb-uplink";`
// during app bootstrap (packages/app/src/main.tsx's static-import set,
// alongside kerbalism/avionics: this Uplink is out of the runtime-loader's
// scope, same as those two).

export type { MechJebActions } from "./MechJeb";
export { MechJebComponent } from "./MechJeb";

// Side-effect registration. Kept as bare imports so the built dist/index.js
// retains them and bundlers won't tree-shake the registerComponent() call away.
import "./uplink"; // defineUplinkClient(MECHJEB): the widget below stamps `owner: MECHJEB`
import "./MechJeb";

// This Uplink's own commands: the `CommandArgsMap`/`CommandReplyMap`
// augmentation and the runtime registration. RE-EXPORTED rather than imported
// for side effect, for the same reason ./topics is: a bare import is elided from
// the emitted `dist/index.d.ts` and the augmentation would not cross the package
// boundary.
export { UPLINK_COMMAND_IDS } from "./commands";
