#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The <c>vessel.attitude</c> channel payload — pitch/heading/roll in the ONE
/// documented frame (CoM-referenced surface frame, MechJeb construction —
/// see <c>Gonogo.KSP.KspHost.BuildAttitude</c>'s doc comment). Kills V-9: the
/// Telemachus <c>n.heading</c>/<c>n.heading2</c>/<c>n.rawheading</c>/
/// <c>n.rawheading2</c> quartet (root vs CoM, raw vs adjusted, no guidance
/// which to use) is deliberately NOT reproduced — if a second frame is ever
/// needed it becomes a new NAMED field with a frame tag, never a numeric
/// suffix. Not derivable from orbital elements (attitude depends on vessel
/// orientation, not trajectory), hence streamed raw.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class VesselAttitude
{
    /// <summary>Degrees, -90..90 (nose down/up).</summary>
    public double Pitch { get; set; }

    /// <summary>Degrees, 0..360.</summary>
    public double Heading { get; set; }

    /// <summary>Degrees, -180..180.</summary>
    public double Roll { get; set; }

    public PayloadMeta Meta { get; set; } = new();
}
