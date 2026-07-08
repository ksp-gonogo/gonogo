#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Raw readings for whichever part is hottest by internal-temperature ratio
/// — see <see cref="VesselThermal.HottestPart"/>.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class ThermalHottestPart
{
    public double InternalTemp { get; set; }
    public double MaxTemp { get; set; }
    public double SkinTemp { get; set; }
    public double SkinMaxTemp { get; set; }
}

/// <summary>
/// The <c>vessel.thermal</c> channel payload — kills P-5 (the int-where-
/// object-expected "partless-paused" sentinel, and the divide-by-zero/NaN
/// risk of a part with <c>maxTemp &lt;= 0</c>): both ratios are typed
/// <c>double?</c>, null meaning "no part had a valid <c>maxTemp</c>/
/// <c>skinMaxTemp</c> this tick" — a distinct, typed state, never an
/// indistinguishable-from-real-data <c>0.0</c> ("no valid part" vs. "coldest
/// possible part").
///
/// <para>Whole-channel absence (the outer <c>VesselThermal?</c> being null)
/// means the vessel currently has no parts at all (KspHost's
/// <c>BuildThermal</c> returns no group in that case) — a DIFFERENT,
/// coarser absence than an individual null ratio.</para>
///
/// <para><b>Deliberately deferred</b> (G-12, per the design doc):
/// <c>hottestPartName</c>, engine family, heat-shield split — a future
/// ThermalStatus migration degrades to headline ratios only until those
/// land.</para>
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class VesselThermal
{
    /// <summary>Null = no part this tick had a valid (&gt; 0) <c>skinMaxTemp</c> — typed, never 0.0.</summary>
    public double? MaxSkinTempRatio { get; set; }

    /// <summary>Null = no part this tick had a valid (&gt; 0) <c>maxTemp</c> — typed, never 0.0.</summary>
    public double? MaxInternalTempRatio { get; set; }

    /// <summary>Null = no part qualified as "hottest" (same no-valid-part condition as <see cref="MaxInternalTempRatio"/>).</summary>
    public ThermalHottestPart? HottestPart { get; set; }

    public PayloadMeta Meta { get; set; } = new();
}
