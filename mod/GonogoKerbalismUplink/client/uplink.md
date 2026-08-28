Puts a [Kerbalism](https://github.com/Kerbalism/Kerbalism) vessel's life support
on the dashboard as one ledger: every profile resource as a meter, the per-source
rates that move it, the wear gauges, the habitat, the processes, and the power
that everything else depends on.

Kerbalism kills crews slowly and for reasons that are several steps removed from
the symptom. A greenhouse stops producing because a process stopped, because a
resource ran out, because a converter lost power. A meter alone tells you the
number is falling and not why, so each resource carries the rate ledger of what
is feeding and draining it, and the widget leads with a root-cause line rather
than making you read six gauges and infer one.

The mod half never links Kerbalism's assembly and never derives from its types.
Every member is reached by runtime reflection, so the Uplink loads
presence-safe when Kerbalism is absent; Kerbalism's attribution ships beside the
plugin in `NOTICE-Kerbalism.txt`.

## Install

Needs [Kerbalism](https://github.com/Kerbalism/Kerbalism), through CKAN. With it
absent the Uplink loads, publishes nothing, and the widget says so rather than
rendering empty meters that read as a vessel with no supplies.
