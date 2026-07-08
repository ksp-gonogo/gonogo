#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif
using System.Collections.Generic;

namespace Sitrep.Contract;

/// <summary>
/// One resource's current/max amounts — see <see cref="VesselResources"/>'s
/// class doc comment for the three-way absence semantics this type
/// participates in.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class ResourceAmount
{
    public double Current { get; set; }
    public double Max { get; set; }

    /// <summary>
    /// R7 Fix 2: explicit presence flag so a present-but-zero resource
    /// (<c>{current: 0, max: &gt; 0, active: true}</c>) is distinguishable
    /// from one that has stopped being reported — killing the R-3
    /// "absence-as-signal" Telemachus wart where a resource simply vanishing
    /// from the map created a 0-vs-unknown ambiguity. Producers set this true
    /// for every resource they actually report this tick; a consumer treating
    /// a missing/false entry as "not reported" then never confuses it with a
    /// genuine zero reading. This is presence ONLY — flow/rate is a separate
    /// future channel (see this class's doc comment), deliberately not added here.
    /// </summary>
    public bool Active { get; set; } = true;
}

/// <summary>
/// The <c>vessel.resources</c> channel payload — a keyframed map, keyed by
/// resource name. Kills R-1 (<c>SumResources</c>'s <c>-1</c> sentinel for an
/// absent/empty resource — never reproduced here), R-3 (row-vanishing
/// ambiguity), R-4 (<c>{}</c>-for-dead-id).
///
/// <para><b>Three-way typed absence (R1):</b></para>
/// <list type="bullet">
/// <item><description><b>Key ABSENT</b> from <see cref="Resources"/> —
/// structural: this vessel does not carry the resource at all (KspHost
/// omits any resource with <c>maxAmount &lt;= 0</c>). Changes only on
/// staging/docking.</description></item>
/// <item><description><b>Key present, <c>{current: 0, max: &gt; 0}</c></b> —
/// carried but currently empty (a real, meaningful reading, not an error).</description></item>
/// <item><description><b>Whole channel absent/stale</b> — no vessel at all
/// (R1(b), same convention as every other <c>vessel.*</c> channel).</description></item>
/// </list>
/// Because every emission is the FULL map (a structured, keyframed channel,
/// never a delta), a key disappearing between two emissions is itself a real
/// structural statement (the vessel stopped carrying that resource — e.g. a
/// tank was staged away), never an ambiguous "did it change or did the
/// stream just drop it" (R-3's ambiguity).
///
/// <para><b>Deliberately deferred</b> (per m1-provider-taxonomy-design.md
/// §2.2): flow/rates (R-2/R-5) — those belong to a future parts/power
/// channel family with per-module provenance; bolting a vessel-total
/// <c>flow</c> on now would reproduce R-6 (a "truth" number that isn't the
/// game's truth).</para>
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class VesselResources
{
    public Dictionary<string, ResourceAmount> Resources { get; set; } = new();

    public PayloadMeta Meta { get; set; } = new();
}
