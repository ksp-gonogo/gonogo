#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif
using System.Collections.Generic;

namespace Sitrep.Contract;

/// <summary>
/// One resource's amounts aboard the vessel. See <see cref="VesselResources"/>
/// for what an absent key and an absent channel mean.
/// </summary>
/// <category>Vessel</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class ResourceAmount
{
    /// <summary>
    /// How much of the resource the vessel holds now, the amount
    /// <c>Vessel.GetConnectedResourceTotals</c> reports. <c>0</c> with a
    /// positive <see cref="Max"/> is a real reading: carried and empty.
    /// </summary>
    [SitrepUnit(Units.ResourceUnits)]
    public double Current { get; set; }
    /// <summary>
    /// The vessel's capacity for the resource, the maximum
    /// <c>Vessel.GetConnectedResourceTotals</c> reports. Always greater than
    /// zero: a resource with no capacity is left out of the map.
    /// </summary>
    [SitrepUnit(Units.ResourceUnits)]
    public double Max { get; set; }

    /// <summary>
    /// Presence flag: <c>true</c> for every resource reported this tick, so a
    /// present-but-zero resource (<c>{current: 0, max: &gt; 0, active: true}</c>)
    /// is distinguishable from one that is not reported. Treat a missing or
    /// <c>false</c> entry as "not reported", never as a zero reading. This is
    /// presence ONLY: it says nothing about flow or rate.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool Active { get; set; } = true;
}

/// <summary>
/// The <c>vessel.resources</c> channel payload: a keyframed map, keyed by
/// resource name. No value is ever a sentinel such as <c>-1</c>.
///
/// <para>Only these stock resources are reported: <c>LiquidFuel</c>,
/// <c>Oxidizer</c>, <c>SolidFuel</c>, <c>MonoPropellant</c>,
/// <c>ElectricCharge</c>, <c>XenonGas</c>, <c>Ore</c> and
/// <c>Ablator</c>.</para>
///
/// <para><b>Three-way typed absence:</b></para>
/// <list type="bullet">
/// <item><description><b>Key ABSENT</b> from <see cref="Resources"/>:
/// structural: this vessel does not carry the resource at all (its capacity is
/// zero). Changes only on staging/docking.</description></item>
/// <item><description><b>Key present, <c>{current: 0, max: &gt; 0}</c></b>,
/// carried but currently empty (a real, meaningful reading, not an
/// error).</description></item>
/// <item><description><b>Whole channel absent</b>: no vessel at all, the
/// same convention as every other <c>vessel.*</c>
/// channel.</description></item>
/// </list>
/// Because every emission is the FULL map (a structured, keyframed channel,
/// never a delta), a key disappearing between two emissions is itself a real
/// structural statement (the vessel stopped carrying that resource, e.g. a
/// tank was staged away), never an ambiguous "did it change or did the
/// stream just drop it".
///
/// <para>Carries amounts only, no flow or rate: a vessel-total flow would be a
/// number that is not the game's own.</para>
/// <internal>
/// Filled by <c>Gonogo.KSP.KspHost.BuildResources</c> over
/// <c>TrackedResourceNames</c>, mapped by
/// <c>Sitrep.Host.VesselViewProvider.BuildResources</c>. Rates belong to a
/// parts/power channel family with per-module provenance.
/// </internal>
/// </summary>
/// <category>Vessel</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("vessel.resources")]
public class VesselResources
{
    /// <summary>
    /// DYNAMIC-KEY MAP keyed by KSP resource name (e.g.
    /// <c>"LiquidFuel"</c>): enumerate the keys rather than reaching for one
    /// you expect. Empty, never null, for a vessel carrying none of the
    /// reported resources.
    /// </summary>
    public Dictionary<string, ResourceAmount> Resources { get; set; } = new();

    /// <summary>
    /// Provenance: <c>"vessel:&lt;guid&gt;"</c> for the vessel the amounts
    /// belong to.
    /// </summary>
    public PayloadMeta Meta { get; set; } = new();
}
