#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The <c>vessel.flight</c> channel payload: MEASUREMENTS, not evaluations:
/// quantities the game measures that aren't derivable from orbital elements
/// (terrain height, aero state) or that serve as off-rails ground truth
/// (speeds). Kills V-10 (no (0,0) lat/long sentinel, the channel is simply
/// absent when there's no vessel, never a fake origin point) and V-12 (one
/// canonical field per quantity: the srfSpeed/speed/surfaceSpeed triplet and
/// kPa/Pa variants collapse to <see cref="SurfaceSpeed"/> and
/// <see cref="DynamicPressureKPa"/>). <c>missionTime</c> deliberately does
/// NOT appear here: see <see cref="VesselIdentity.LaunchUt"/>'s doc comment.
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("vessel.flight")]
public class VesselFlight
{
    /// <summary>Degrees. PRESENT means valid, no (0,0) no-data sentinel (V-10); absence is the whole channel being unavailable.</summary>
    [SitrepUnit(Units.Degrees)]
    public double Latitude { get; set; }

    [SitrepUnit(Units.Degrees)]
    public double Longitude { get; set; }

    /// <summary>Altitude above sea level, metres (KSP's <c>Vessel.altitude</c>).</summary>
    [SitrepUnit(Units.Metres)]
    public double AltitudeAsl { get; set; }

    /// <summary>Height above terrain (AGL, radar altitude), metres, NOT derivable from orbital elements, hence streamed raw.</summary>
    [SitrepUnit(Units.Metres)]
    public double AltitudeTerrain { get; set; }

    /// <summary>Metres per second (KSP's <c>Vessel.verticalSpeed</c>), signed: negative is descending.</summary>
    [SitrepUnit(Units.MetresPerSecond)]
    public double VerticalSpeed { get; set; }

    /// <summary>Speed relative to the surface, metres per second (KSP's <c>Vessel.srfSpeed</c>).</summary>
    [SitrepUnit(Units.MetresPerSecond)]
    public double SurfaceSpeed { get; set; }

    /// <summary>Speed relative to the parent body's inertial frame, metres per second (KSP's <c>Vessel.obt_speed</c>).</summary>
    [SitrepUnit(Units.MetresPerSecond)]
    public double OrbitalSpeed { get; set; }

    /// <summary>Multiples of standard gravity (KSP's <c>Vessel.geeForce</c>).</summary>
    [SitrepUnit(Units.GForce)]
    public double GForce { get; set; }

    [SitrepUnit(Units.Kilopascals)]
    public double DynamicPressureKPa { get; set; }

    /// <summary>Mach number: dimensionless by definition, so it carries the explicit "1" unit token rather than being left unannotated.</summary>
    [SitrepUnit(Units.Dimensionless)]
    public double Mach { get; set; }

    /// <summary>Atmospheric density at the vessel's position, kg/m³ (KSP's <c>Vessel.atmDensity</c>).</summary>
    [SitrepUnit(Units.KilogramsPerCubicMetre)]
    public double AtmDensity { get; set; }

    /// <summary>Skin/ambient external temperature the vessel is exposed to, Kelvin (Vessel.externalTemperature).</summary>
    [SitrepUnit(Units.Kelvin)]
    public double ExternalTemperature { get; set; }

    /// <summary>Ambient atmospheric temperature at the vessel's position, Kelvin (Vessel.atmosphericTemperature).</summary>
    [SitrepUnit(Units.Kelvin)]
    public double AtmosphericTemperature { get; set; }

    public PayloadMeta Meta { get; set; } = new();
}
