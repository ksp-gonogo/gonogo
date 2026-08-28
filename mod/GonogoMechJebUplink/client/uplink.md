Flies the vessel from the console. Engage
[MechJeb2](https://github.com/MuMech/MechJeb2)'s ascent autopilot, execute the
next maneuver node, or land at the selected target, dispatched over the delayed
command path with per-command in-flight state.

The delay is the interesting part. Every one of these is a real command with a
real round trip, so under light-time the widget holds each one in flight for the
whole journey rather than reporting an outcome it cannot know yet. Handing an
autopilot a burn and watching the acknowledgement arrive four minutes later is
what remote flight actually feels like, and the point of driving MechJeb from
here rather than from the in-game window.

This assembly compile-time links MechJeb2 and is licensed GPLv3 to match, the
same rationale as the kOS Uplink. Reflection is used only for the version
guard's presence and shape probe.

## Install

Needs [MechJeb2](https://github.com/MuMech/MechJeb2), through CKAN. With it
absent the Uplink loads, the commands are not offered, and the widget says why
rather than sending commands nothing will answer.
