Brings [RP-1](https://github.com/KSP-RO/RP-0)'s career layer to the dashboard:
Programs with their objectives, deadlines and funding curves, the Confidence
price and term at each speed, and the per-year funding summary those payments
follow.

RP-1's career is a schedule, not a scoreboard. A Program pays on a curve, costs
Confidence at a rate that depends on the speed you picked, and expires on a date.
Those four facts decide what to launch next and none of them is legible from a
single number, so the widget shows the whole Program rather than a balance.

## Simulations and light-time

RP-1 simulations are exempt from signal delay by default, and off is the honest
reading: a simulation is a ground-side rehearsal with no spacecraft, so there is
no light-time, and delaying it models a distance to a craft that is not there.

The setting exists for the case where you want the rehearsal to have the
conditions of the real flight. It is enforced by the mod rather than by this
console, so turning it on applies to withheld telemetry and to every command
alike, not just to what the dashboard chooses to grey out.

The mod half never links RP-0's assembly and never derives from its types. Every
RP-1 member is reached by runtime reflection, which keeps this assembly clear of
RP-1's NonCommercial ShareAlike terms; RP-1's attribution notice ships beside the
plugin in `NOTICE-RP1.txt`.

## Install

Needs [RP-1](https://github.com/KSP-RO/RP-0) and the Realism Overhaul stack it
sits on, and a career save. With RP-1 absent the Uplink loads, publishes nothing,
and the widgets say so rather than showing an empty career.
