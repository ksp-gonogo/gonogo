#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Raw readings for whichever part is hottest by internal-temperature ratio;
/// see <see cref="VesselThermal.HottestPart"/>.
/// </summary>
/// <category>Vessel</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class ThermalHottestPart
{
    /// <summary>Kelvin (KSP's <c>Part.temperature</c>). All four readings on this record share the unit, which is what makes the ratios on <see cref="VesselThermal"/> dimensionless.</summary>
    [SitrepUnit(Units.Kelvin)]
    public double InternalTemp { get; set; }

    /// <summary>The part's maximum internal temperature, Kelvin (<c>Part.maxTemp</c>). Always greater than 0, since only a part with a valid maximum can be the hottest.</summary>
    [SitrepUnit(Units.Kelvin)]
    public double MaxTemp { get; set; }

    /// <summary>The part's current skin temperature, Kelvin (<c>Part.skinTemperature</c>).</summary>
    [SitrepUnit(Units.Kelvin)]
    public double SkinTemp { get; set; }

    /// <summary>The part's maximum skin temperature, Kelvin (<c>Part.skinMaxTemp</c>), passed through raw: KSP reports <c>-1</c> for a part with no skin-thermal model, and that value arrives here unchanged.</summary>
    [SitrepUnit(Units.Kelvin)]
    public double SkinMaxTemp { get; set; }

    /// <summary>Display name of the hottest part (<c>Part.partInfo.title</c>, falling back to <c>Part.name</c>, same convention as <see cref="Sitrep.Contract.VesselPart.Title"/>). Never null when <see cref="VesselThermal.HottestPart"/> itself is non-null.</summary>
    [SitrepUnit(Units.Text)]
    public string Name { get; set; } = "";

    /// <summary><c>Part.flightID</c> stringified, the same join key as <see cref="Sitrep.Contract.VesselPart.Id"/>, so a client can tell WHICH part is hottest where several share <see cref="Name"/> (a symmetric craft). <c>null</c> when the part has no live flight id yet.</summary>
    [SitrepUnit(Units.Id)]
    public string? Id { get; set; }
}

/// <summary>
/// The <c>vessel.thermal</c> channel payload: the active vessel's thermal
/// rollup, its hottest part, heat shield and engine. Each ratio is null when
/// no part had a valid maximum temperature this tick, never 0, so "no valid
/// part" and "coldest possible part" stay distinct.
///
/// <para>The whole payload is null when the vessel has no parts at all, a
/// different, coarser absence than an individual null ratio. For every part's
/// temperatures rather than a rollup, see <c>vessel.parts</c>.</para>
/// <internal>
/// Filled from KspHost.BuildThermal, which returns no group for a partless
/// vessel.
/// </internal>
/// </summary>
/// <category>Vessel</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("vessel.thermal")]
public class VesselThermal
{
    /// <summary>The highest skin-temperature ratio (<c>skinTemperature / skinMaxTemp</c>) of any part this tick; 1 is at the limit. Not necessarily <see cref="HottestPart"/>'s. Null when no part had a valid (&gt; 0) <c>skinMaxTemp</c>, never 0.</summary>
    [SitrepUnit(Units.Ratio)]
    public double? MaxSkinTempRatio { get; set; }

    /// <summary>The highest internal-temperature ratio (<c>temperature / maxTemp</c>) of any part this tick, which is <see cref="HottestPart"/>'s; 1 is at the limit. Null when no part had a valid (&gt; 0) <c>maxTemp</c>, never 0.</summary>
    [SitrepUnit(Units.Ratio)]
    public double? MaxInternalTempRatio { get; set; }

    /// <summary>The part with the highest internal-temperature ratio. Null when no part qualified, the same condition as a null <see cref="MaxInternalTempRatio"/>.</summary>
    public ThermalHottestPart? HottestPart { get; set; }

    /// <summary>Hottest heat-shield part's internal temperature (K, raw: the part carrying a <c>ModuleAblator</c>, <c>Part.temperature</c>). Null when the vessel carries no ablative heat shield this tick.</summary>
    [SitrepUnit(Units.Kelvin)]
    public double? HeatShieldTemp { get; set; }

    /// <summary>The same heat shield's ablative heat flux (<c>ModuleAblator.flux</c>, kW). Null when the vessel carries no ablative heat shield this tick.</summary>
    [SitrepUnit(Units.Kilowatts)]
    public double? HeatShieldFlux { get; set; }

    /// <summary>Internal temperature (K) of whichever part carrying a <c>ModuleEngines</c> or <c>ModuleEnginesFX</c> module has the highest internal-temperature ratio. Null when the vessel carries no engine part with a valid <c>maxTemp</c> this tick.</summary>
    [SitrepUnit(Units.Kelvin)]
    public double? HottestEngineTemp { get; set; }

    /// <summary>That same engine part's max internal temperature (K, raw). Null under the same no-engine-parts condition as <see cref="HottestEngineTemp"/>.</summary>
    [SitrepUnit(Units.Kelvin)]
    public double? HottestEngineMaxTemp { get; set; }

    /// <summary>That same engine part's internal-temperature ratio (<c>temperature / maxTemp</c>). Null under the same no-engine-parts condition as <see cref="HottestEngineTemp"/>.</summary>
    [SitrepUnit(Units.Ratio)]
    public double? HottestEngineTempRatio { get; set; }

    /// <summary>True when any engine part's internal-temperature ratio is at or above 0.9. False, not null, whenever the vessel has an engine part and none crosses it; null only alongside a null <see cref="HottestEngineTempRatio"/>, when no engine part with a valid <c>maxTemp</c> was found this tick.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? AnyEnginesOverheating { get; set; }

    /// <summary>The payload's provenance, <c>"vessel:&lt;guid&gt;"</c> for the active vessel, and quality.</summary>
    public PayloadMeta Meta { get; set; } = new();
}
