Brings a full-fidelity aerodynamic model's own numbers to the flight board:
angle of attack, sideslip, stall fraction, lift and drag, as
[Ferram Aerospace Research](https://github.com/dkavolis/Ferram-Aerospace-Research)
computes them rather than as stock KSP approximates them.

Under FAR the aerodynamic state is the thing that ends a launch, and it is not
visible from the stock instruments. An ascent that is one degree of angle of
attack from a stall reads the same on a navball as one that is not, and the
first is a lost vehicle. The widget's job is to make the margin legible while
there is still time to fly out of it.

The mod half never links `FerramAerospaceResearch.dll` and never derives from
its types. Every FAR member is reached by runtime reflection, which keeps this
assembly clear of any ShareAlike obligation; FAR's attribution notice ships
beside the plugin in `NOTICE-FAR.txt`.

## Install

Needs [FAR](https://github.com/dkavolis/Ferram-Aerospace-Research), through CKAN
or by hand. With FAR absent the Uplink loads and publishes nothing, and the
widget says there is no reading for this vessel rather than showing stock numbers
under a FAR heading.
