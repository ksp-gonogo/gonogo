Elects [RealAntennas](https://github.com/KSP-RO/RealAntennas) as the comms
backend when it is installed, so the comms readouts describe the RF link the game
is actually simulating: the link geometry, the data rate, and a re-derived link
margin.

This Uplink adds no widget of its own, and that is the design rather than an
omission. Comms already has a home on the dashboard, so what an RF backend owes
the board is better numbers in the place the operator already looks. It
contributes the per-hop data rates into that widget and adds an RF section and
badge to it, so an install with RealAntennas and one without show the same
widget with different fidelity instead of two competing panels.

The mod half never links RealAntennas' assembly and never derives from its types.
Every member is reached by runtime reflection, which keeps this assembly clear of
RealAntennas' ShareAlike terms; its attribution notice ships beside the plugin in
`NOTICE-REALANTENNAS.txt`.

## Install

Needs [RealAntennas](https://github.com/KSP-RO/RealAntennas), through CKAN. With
it absent the Uplink loads and elects nothing, and the comms widget keeps its
stock CommNet reading: the sections below are presence-gated, so they are simply
not there rather than empty.
