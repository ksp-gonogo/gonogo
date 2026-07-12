#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The <c>vessel.flight</c> channel payload — MEASUREMENTS, not evaluations:
/// quantities the game measures that aren't derivable from orbital elements
/// (terrain height, aero state) or that serve as off-rails ground truth
/// (speeds). Kills V-10 (no (0,0) lat/long sentinel — the channel is simply
/// absent when there's no vessel, never a fake origin point) and V-12 (one
/// canonical field per quantity: the srfSpeed/speed/surfaceSpeed triplet and
/// kPa/Pa variants collapse to <see cref="SurfaceSpeed"/> and
/// <see cref="DynamicPressureKPa"/>). <c>missionTime</c> deliberately does
/// NOT appear here — see <see cref="VesselIdentity.LaunchUt"/>'s doc comment.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
[SitrepTopic("vessel.flight")]
public class VesselFlight
{
    /// <summary>Degrees. PRESENT means valid — no (0,0) no-data sentinel (V-10); absence is the whole channel being unavailable.</summary>
    public double Latitude { get; set; }

    public double Longitude { get; set; }

    public double AltitudeAsl { get; set; }

    /// <summary>Height above terrain (AGL, radar altitude), metres — NOT derivable from orbital elements, hence streamed raw.</summary>
    public double AltitudeTerrain { get; set; }

    public double VerticalSpeed { get; set; }

    public double SurfaceSpeed { get; set; }

    public double OrbitalSpeed { get; set; }

    public double GForce { get; set; }

    public double DynamicPressureKPa { get; set; }

    public double Mach { get; set; }

    public double AtmDensity { get; set; }

    /// <summary>Skin/ambient external temperature the vessel is exposed to, Kelvin (Vessel.externalTemperature).</summary>
    public double ExternalTemperature { get; set; }

    /// <summary>Ambient atmospheric temperature at the vessel's position, Kelvin (Vessel.atmosphericTemperature).</summary>
    public double AtmosphericTemperature { get; set; }

    public PayloadMeta Meta { get; set; } = new();
}
