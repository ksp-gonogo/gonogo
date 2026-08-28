// GonogoAvionicsUplink client for gonogo.
//
// Co-located with the GonogoAvionicsUplink C# mod (mod/GonogoAvionicsUplink):
// one directory holds the mod and the client TS it ships (Uplink architecture
// §1). Importing this package's entry point side-effects the widget
// registration into the global component registry:
//
//   - `AvionicsGoNoGo` → registerComponent({ id: "avionics-go-no-go", ... })
//     so the RP-1 controllable-mass ascent go/no-go is placeable from the
//     dashboard widget picker.
//
// `./uplink` declares the client identity the widget above stamps as `owner`,
// so the picker's mod search tags derive "avionics" from the registration.
//
// It also declares the bare `avionics.available` presence primitive
// (`./topics`) so the client type system knows the TrueNow boolean Topic.
import "./uplink";
import "./topics";
import "./AvionicsGoNoGo";

export { AvionicsGoNoGoComponent } from "./AvionicsGoNoGo";
