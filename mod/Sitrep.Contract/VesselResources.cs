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
#if NETSTANDARD2_0
[TsInterface]
#endif
public class ResourceAmount
{
    public double Current { get; set; }
    public double Max { get; set; }
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
#if NETSTANDARD2_0
[TsInterface]
#endif
public class VesselResources
{
    public Dictionary<string, ResourceAmount> Resources { get; set; } = new();

    public Meta Meta { get; set; } = new();
}
