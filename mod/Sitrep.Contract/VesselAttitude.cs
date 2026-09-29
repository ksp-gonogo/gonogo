#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The <c>vessel.attitude</c> channel payload: pitch, heading and roll of the
/// vessel's control reference (<c>Vessel.GetTransform()</c>) against the local
/// surface up and north, in two named frames.
///
/// <para><see cref="Pitch"/>, <see cref="Heading"/> and <see cref="Roll"/> are
/// the primary frame, with up and north measured at <c>Vessel.CoM</c> (MechJeb's
/// construction). <see cref="PitchRootFrame"/>, <see cref="HeadingRootFrame"/>
/// and <see cref="RollRootFrame"/> measure up and north at the root part's
/// position instead. The orientation is the same in both; the two differ only
/// when the root part sits away from the centre of mass. Without a root part
/// the root frame repeats the primary one.</para>
///
/// <para>Absent when the vessel has no reference body. Attitude is not
/// derivable from orbital elements, so it is streamed raw.</para>
/// <internal>Built by <c>Gonogo.KSP.KspHost.BuildAttitude</c>.</internal>
/// </summary>
/// <category>Vessel</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("vessel.attitude")]
public class VesselAttitude
{
    /// <summary>Pitch above the horizon, measured at the centre of mass. Degrees, -90 (nose down) to 90 (nose up).</summary>
    [SitrepUnit(Units.Degrees)]
    public double Pitch { get; set; }

    /// <summary>Compass heading, measured at the centre of mass. Degrees, 0 to 360, clockwise from north.</summary>
    [SitrepUnit(Units.Degrees)]
    public double Heading { get; set; }

    /// <summary>Roll, measured at the centre of mass. Degrees, -180 to 180.</summary>
    [SitrepUnit(Units.Degrees)]
    public double Roll { get; set; }

    /// <summary>As <see cref="Pitch"/>, measured at the root part. Degrees, -90 to 90.</summary>
    [SitrepUnit(Units.Degrees)]
    public double PitchRootFrame { get; set; }

    /// <summary>As <see cref="Heading"/>, measured at the root part. Degrees, 0 to 360.</summary>
    [SitrepUnit(Units.Degrees)]
    public double HeadingRootFrame { get; set; }

    /// <summary>As <see cref="Roll"/>, measured at the root part. Degrees, -180 to 180.</summary>
    [SitrepUnit(Units.Degrees)]
    public double RollRootFrame { get; set; }

    /// <summary>The payload's provenance (<c>"vessel:&lt;guid&gt;"</c>) and quality.</summary>
    public PayloadMeta Meta { get; set; } = new();
}
