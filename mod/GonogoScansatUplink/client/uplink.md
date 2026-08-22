Brings [SCANsat](https://github.com/S-C-A-N/SCANsat)'s orbital survey data onto the
mission-control dashboard: what has been scanned, by which craft, and where the
anomalies are.

SCANsat's own in-game windows are the authority on all of this. What this Uplink adds
is the part a second screen is for: the survey state visible continuously, beside
everything else, without pausing to open a map view.

## Install

Install SCANsat through CKAN as usual, then the Gonogo SCANsat Uplink alongside it.
Every surface here is presence-gated on SCANsat reporting in, so an install without
SCANsat shows one line saying so rather than a row of empty gauges.

## widget:scanning

Coverage is per scan type and per body, because that is how SCANsat tracks it: a body
can be fully altimetry-mapped and completely unsurveyed for resources. The five rows
are the five types worth watching; the others exist on the wire and are noise on a
dashboard.

The live view is a window on the active craft's own sub-point, painted from the biome
colourmap and gated by the same coverage mask the map layers use, so an unscanned
patch is genuinely dark rather than guessed at. The cyan rectangle is the craft's
current ground track, at SCANsat's own field of view.

Anomalies are listed whether or not they have been identified: an undetected one still
tells you there is something on this body to find.
