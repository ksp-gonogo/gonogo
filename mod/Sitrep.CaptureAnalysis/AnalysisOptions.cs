using System.Collections.Generic;

namespace Sitrep.CaptureAnalysis;

/// <summary>
/// Everything the analysis needs that the capture itself does not carry.
///
/// <para>Each of these is optional, and every one of them that is left out
/// closes a gate rather than picking a default. A default here would be a
/// guess wearing a number's clothes: Kerbin's rotation period is not a safe
/// fallback (KSP overwrites it for tidally-locked bodies), and neither is the
/// KSC's position (the capture may never have talked to the KSC).</para>
/// </summary>
public sealed class AnalysisOptions
{
    /// <summary>
    /// How long the capture ran by the WALL clock. The frames carry only UT, so
    /// this is the only way to recover the time-warp factor, and without it the
    /// tool says so rather than assuming 1x.
    /// </summary>
    public double? WallClockSeconds { get; set; }

    /// <summary>Occluding radii supplied by hand, used when the capture has no <c>comms.occlusion</c> frames of its own.</summary>
    public List<OcclusionCandidate> Candidates { get; } = new();

    /// <summary>The parent body's bare mean radius, metres. Needed to place a ground station on its surface.</summary>
    public double? BodyRadiusMeters { get; set; }

    /// <summary>The parent body's sidereal rotation period, seconds. Read it live from the body; do not take it from a wiki table.</summary>
    public double? RotationPeriodSeconds { get; set; }

    public double? StationLatitudeDeg { get; set; }

    /// <summary>
    /// The station's INERTIAL longitude at the capture's first orbit epoch: the
    /// body-fixed longitude plus however far the body had already turned. The two
    /// are only the same when the body's rotation angle happened to be zero.
    /// </summary>
    public double? StationLongitudeDeg { get; set; }

    public double StationAltitudeMeters { get; set; }

    /// <summary>Sweep step. Defaults to a 0.5 degree relative arc (period/720), which puts every low orbit at 3-6 s.</summary>
    public double? SweepStepSeconds { get; set; }

    public bool HasStation =>
        StationLatitudeDeg.HasValue
        && StationLongitudeDeg.HasValue
        && BodyRadiusMeters.HasValue
        && RotationPeriodSeconds.HasValue;
}
