#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The <c>vessel.attitude</c> channel payload — pitch/heading/roll in TWO
/// named frames, both anchored to the same reference-transform ORIENTATION
/// but measuring the surface up/north vectors from a different POSITION (see
/// <c>Gonogo.KSP.KspHost.BuildAttitude</c>'s doc comment for the shared
/// construction). Kills V-9: the Telemachus <c>n.heading</c>/
/// <c>n.heading2</c>/<c>n.rawheading</c>/<c>n.rawheading2</c> quartet (root
/// vs CoM, raw vs adjusted, no guidance which to use) is NOT reproduced by
/// numeric suffix — per this class's original decision, a second frame is a
/// new NAMED field with a frame tag: <see cref="Pitch"/>/<see cref="Heading"/>/
/// <see cref="Roll"/> are the CoM-referenced frame (up/north measured from
/// <c>Vessel.CoM</c> — MechJeb's construction), and
/// <see cref="PitchRootFrame"/>/<see cref="HeadingRootFrame"/>/
/// <see cref="RollRootFrame"/> are the genuinely distinct ROOT-PART-referenced
/// frame (up/north measured from <c>Vessel.rootPart</c>'s position instead —
/// the two diverge whenever the root part sits away from the vessel's centre
/// of mass). Not derivable from orbital elements (attitude depends on vessel
/// orientation, not trajectory), hence streamed raw.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
[SitrepTopic("vessel.attitude")]
public class VesselAttitude
{
    /// <summary>CoM-referenced frame. Degrees, -90..90 (nose down/up).</summary>
    public double Pitch { get; set; }

    /// <summary>CoM-referenced frame. Degrees, 0..360.</summary>
    public double Heading { get; set; }

    /// <summary>CoM-referenced frame. Degrees, -180..180.</summary>
    public double Roll { get; set; }

    /// <summary>Root-part-referenced frame (see class doc). Degrees, -90..90.</summary>
    public double PitchRootFrame { get; set; }

    /// <summary>Root-part-referenced frame (see class doc). Degrees, 0..360.</summary>
    public double HeadingRootFrame { get; set; }

    /// <summary>Root-part-referenced frame (see class doc). Degrees, -180..180.</summary>
    public double RollRootFrame { get; set; }

    public PayloadMeta Meta { get; set; } = new();
}
