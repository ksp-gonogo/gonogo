#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The <c>vessel.flight</c> channel payload: MEASUREMENTS, not evaluations:
/// quantities the game measures that aren't derivable from orbital elements
/// (terrain height, aero state) or that serve as off-rails ground truth
/// (speeds). One field per quantity.
///
/// <para>The channel is absent when there is no active vessel or any of its
/// fields could not be read; there is never a <c>(0,0)</c> lat/long
/// placeholder. There is no mission time field: see
/// <see cref="VesselIdentity.LaunchUt"/>.</para>
/// </summary>
/// <category>Vessel</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("vessel.flight")]
public class VesselFlight
{
    /// <summary>Latitude of the vessel's position on its reference body, degrees (KSP's <c>Vessel.latitude</c>). Present means valid: there is no <c>(0,0)</c> no-data placeholder, and absence is the whole channel being unavailable.</summary>
    [SitrepUnit(Units.Degrees)]
    public double Latitude { get; set; }

    /// <summary>Longitude of the vessel's position on its reference body, degrees (KSP's <c>Vessel.longitude</c>, passed through without normalising its range). Same presence rule as <see cref="Latitude"/>.</summary>
    [SitrepUnit(Units.Degrees)]
    public double Longitude { get; set; }

    /// <summary>Altitude above sea level, metres (KSP's <c>Vessel.altitude</c>).</summary>
    [SitrepUnit(Units.Metres)]
    // TWO models, one per regime, because the conic stops describing what happens at the
    // atmosphere interface and that is exactly where a descent is watched.
    //
    // Above it: the conic gives the orbital radius; system.bodies is what turns that into an
    // altitude, because the reference body's radius is the only place sea level is published.
    [SitrepReckonable(ReckoningBases.KeplerPropagation, "@vessel.orbit", "@system.bodies")]
    // Below it: the altitude advanced by the observed descent rate. verticalSpeed IS that rate,
    // measured, so it already carries whatever the installed aerodynamics did and no drag model
    // is needed or wanted. gForce bounds how far the rate may be carried, being the sensed
    // non-gravitational magnitude and so a direct read on how fast the regime is changing.
    // system.bodies again, for the atmosphere depth: that depth is the boundary between the two
    // models, and without it neither knows which regime it is in.
    [SitrepReckonable(ReckoningBases.RateIntegration, "verticalSpeed", "gForce", "@system.bodies")]
    public double AltitudeAsl { get; set; }

    /// <summary>Height above terrain (AGL, KSP's <c>Vessel.radarAltitude</c>), metres. Not derivable from orbital elements, so it is streamed as measured.</summary>
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
    // The vis-viva speed falls out of the elements and mu alone. No body radius, so system.bodies
    // is NOT declared: an input a model does not use is a false promise the gate cannot catch.
    [SitrepReckonable(ReckoningBases.KeplerPropagation, "@vessel.orbit")]
    public double OrbitalSpeed { get; set; }

    /// <summary>Multiples of standard gravity (KSP's <c>Vessel.geeForce</c>).</summary>
    [SitrepUnit(Units.GForce)]
    public double GForce { get; set; }

    /// <summary>Dynamic pressure on the vessel, kilopascals (KSP's <c>Vessel.dynamicPressurekPa</c>). <c>0</c> outside an atmosphere.</summary>
    [SitrepUnit(Units.Kilopascals)]
    public double DynamicPressureKPa { get; set; }

    /// <summary>Mach number (KSP's <c>Vessel.mach</c>), dimensionless.</summary>
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

    /// <summary>The payload's provenance (<c>"vessel:&lt;guid&gt;"</c>) and quality.</summary>
    public PayloadMeta Meta { get; set; } = new();
}
