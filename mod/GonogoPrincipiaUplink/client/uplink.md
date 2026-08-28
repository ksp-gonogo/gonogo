Publishes [Principia](https://github.com/mockingbirdnest/Principia)'s n-body
state to the dashboard: the trajectory arcs it integrates, the flight plan and
its burns, the reference frame everything is expressed in, and the integrator
settings the session is running. It also accepts flight-plan edits from the
console.

Under Principia an orbit is not a conic and there is no single set of elements
that describes it, so the readouts a stock board carries either mean something
different or mean nothing. Two consequences shape every row here. The REFERENCE
FRAME is not decoration: the same vessel reads as a different orbit in a
different frame, so the frame is named on the board and carried with the numbers
rather than assumed. And a frame with no centre has no apsides, so those rows are
absent rather than showing a zero.

The Uplink also says plainly when it is not reading. Every row goes quiet
together when the plugin is unavailable or when reading is suspended, and the
commonest cause of the second is the plugin recording a journal, which polling
would write itself into. One row answers why the rest are quiet, so a silent
board is never ambiguous.

The mod half never references any Principia assembly. It binds Principia members
by reflection, and every member it reads is managed and was confirmed against the
decompiled body to touch no plugin code: Principia's native surface aborts the
KSP process on a bad call, and a field read passes it no arguments.

## Install

Needs [Principia](https://github.com/mockingbirdnest/Principia), and a save that
was created under it. With the plugin absent the Uplink loads, publishes nothing,
and the availability row says so.
