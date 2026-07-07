#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The <c>vessel.propulsion</c> channel payload — the TWR/burn-time
/// derivation inputs (G-4). <see cref="TotalMass"/>/<see cref="DryMass"/> in
/// tonnes, <see cref="CurrentThrust"/>/<see cref="AvailableThrust"/> in kN
/// (dimensionally consistent for TWR: kN/(t·m/s²) — see
/// m1-provider-taxonomy-design.md §6.7). <see cref="AvailableThrust"/>
/// already excludes shut-down/flamed-out engines at capture (only
/// <c>EngineIgnited &amp;&amp; !flameout</c> engines contribute) — it is
/// "what this vessel can produce RIGHT NOW," not its rated maximum.
/// *Derived, SDK-side, NOT streamed here:* TWR
/// (<c>currentThrust / (totalMass · g)</c>), max-TWR, and a crude vessel-level
/// burn-time estimate (retiring <c>dv.currentTWR</c>/<c>dv.*</c> until a
/// stage sim exists — G-14).
/// </summary>
#if NETSTANDARD2_0
[TsInterface]
#endif
public class VesselPropulsion
{
    public double TotalMass { get; set; }

    public double DryMass { get; set; }

    public double CurrentThrust { get; set; }

    public double AvailableThrust { get; set; }

    public Meta Meta { get; set; } = new();
}
