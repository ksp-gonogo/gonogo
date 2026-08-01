#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Raw readings for whichever part is hottest by internal-temperature ratio;
/// see <see cref="VesselThermal.HottestPart"/>.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class ThermalHottestPart
{
    /// <summary>Kelvin (KSP's <c>Part.temperature</c>). All four readings on this record share the unit, which is what makes the ratios on <see cref="VesselThermal"/> dimensionless.</summary>
    [SitrepUnit(Units.Kelvin)]
    public double InternalTemp { get; set; }

    [SitrepUnit(Units.Kelvin)]
    public double MaxTemp { get; set; }

    [SitrepUnit(Units.Kelvin)]
    public double SkinTemp { get; set; }

    [SitrepUnit(Units.Kelvin)]
    public double SkinMaxTemp { get; set; }

    /// <summary>Display name of the hottest part (<c>Part.partInfo.title</c>, falling back to <c>Part.name</c>, same convention as <see cref="Sitrep.Contract.VesselPart.Title"/>). Never null when <see cref="VesselThermal.HottestPart"/> itself is non-null.</summary>
    public string Name { get; set; } = "";
}

/// <summary>
/// The <c>vessel.thermal</c> channel payload: kills P-5 (the int-where-
/// object-expected "partless-paused" sentinel, and the divide-by-zero/NaN
/// risk of a part with <c>maxTemp &lt;= 0</c>): both ratios are typed
/// <c>double?</c>, null meaning "no part had a valid <c>maxTemp</c>/
/// <c>skinMaxTemp</c> this tick": a distinct, typed state, never an
/// indistinguishable-from-real-data <c>0.0</c> ("no valid part" vs. "coldest
/// possible part").
///
/// <para>Whole-channel absence (the outer <c>VesselThermal?</c> being null)
/// means the vessel currently has no parts at all (KspHost's
/// <c>BuildThermal</c> returns no group in that case), a DIFFERENT,
/// coarser absence than an individual null ratio.</para>
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
[SitrepTopic("vessel.thermal")]
public class VesselThermal
{
    /// <summary>Null = no part this tick had a valid (&gt; 0) <c>skinMaxTemp</c>, typed, never 0.0.</summary>
    [SitrepUnit(Units.Ratio)]
    public double? MaxSkinTempRatio { get; set; }

    /// <summary>Null = no part this tick had a valid (&gt; 0) <c>maxTemp</c>, typed, never 0.0.</summary>
    [SitrepUnit(Units.Ratio)]
    public double? MaxInternalTempRatio { get; set; }

    /// <summary>Null = no part qualified as "hottest" (same no-valid-part condition as <see cref="MaxInternalTempRatio"/>).</summary>
    public ThermalHottestPart? HottestPart { get; set; }

    /// <summary>Hottest heat-shield part's internal temperature (K, raw: the part carrying a <c>ModuleAblator</c>, <c>Part.temperature</c>). Null when the vessel carries no ablative heat shield this tick. Was °C until the units audit: the wire is SI, and a Celsius display is the client's choice to make.</summary>
    [SitrepUnit(Units.Kelvin)]
    public double? HeatShieldTemp { get; set; }

    /// <summary>The same heat shield's ablative heat flux (<c>ModuleAblator.flux</c>, kW). Null when the vessel carries no ablative heat shield this tick.</summary>
    [SitrepUnit(Units.Kilowatts)]
    public double? HeatShieldFlux { get; set; }

    /// <summary>Internal temperature (K, raw: same unit as <see cref="ThermalHottestPart.InternalTemp"/>) of whichever part carrying a <c>ModuleEngines</c>/<c>ModuleEnginesFX</c> module has the highest internal-temperature ratio. Null when the vessel carries no engine parts this tick.</summary>
    [SitrepUnit(Units.Kelvin)]
    public double? HottestEngineTemp { get; set; }

    /// <summary>That same engine part's max internal temperature (K, raw). Null under the same no-engine-parts condition as <see cref="HottestEngineTemp"/>.</summary>
    [SitrepUnit(Units.Kelvin)]
    public double? HottestEngineMaxTemp { get; set; }

    /// <summary>That same engine part's internal-temperature ratio (<c>temperature / maxTemp</c>). Null under the same no-engine-parts condition as <see cref="HottestEngineTemp"/>.</summary>
    [SitrepUnit(Units.Ratio)]
    public double? HottestEngineTempRatio { get; set; }

    /// <summary>True when ANY engine part's internal-temperature ratio is at or above 0.9, the same "&gt;90% max" threshold ThermalStatus's own inline alert copy already states. False (not null) whenever the vessel has engine parts and none crosses it; null only alongside a null <see cref="HottestEngineTempRatio"/> (no engine parts at all this tick).</summary>
    public bool? AnyEnginesOverheating { get; set; }

    public PayloadMeta Meta { get; set; } = new();
}
