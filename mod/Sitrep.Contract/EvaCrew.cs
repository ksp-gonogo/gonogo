using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// One kerbal currently outside a craft, on the <c>eva.crew</c> channel.
///
/// <para>A kerbal on EVA is a vessel in KSP's model, with its own id, so it
/// already appears on <c>system.vessels</c> and on its own <c>fleet.</c> topics.
/// What is here and nowhere else is the suit: what it is carrying, what it can
/// do, and whether the place it is standing in would kill the wearer without
/// it.</para>
///
/// <para>Every field is <c>null</c> when the value could not be read. Absence is
/// never a zero: a kerbal whose propellant could not be read is not a kerbal
/// with an empty tank.</para>
/// <internal>
/// Read off the <c>KerbalEVA</c> PartModule on the kerbal vessel's root part,
/// not off <c>Vessel</c>, so a kerbal whose part has not finished spawning
/// yields nulls rather than throwing.
/// </internal>
/// </summary>
/// <category>Crew</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class EvaKerbal
{
    /// <summary>The kerbal's own vessel id, the same guid <c>system.vessels</c>
    /// carries for it.</summary>
    [SitrepUnit(Units.Id)]
    public string? KerbalVesselId { get; set; }

    /// <summary>
    /// The vessel id of the craft this kerbal stepped out of, or <c>null</c>
    /// when that is not known (the step-out was not recorded, or the craft has
    /// since gone).
    ///
    /// <para>This is the vessel the mod goes on reporting as active while they
    /// are outside, so a reader that follows the active vessel sees no
    /// discontinuity when a kerbal steps out.</para>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? ParentVesselId { get; set; }

    /// <summary>The kerbal's name, from the EVA vessel's <c>GetName()</c>.</summary>
    [SitrepUnit(Units.Text)]
    public string? Name { get; set; }

    /// <summary>KSP's own situation name for the kerbal (<c>FLYING</c>,
    /// <c>LANDED</c>, ...).</summary>
    [SitrepUnit(Units.Text)]
    public string? Situation { get; set; }

    /// <summary>EVA propellant remaining in the pack.</summary>
    [SitrepUnit(Units.ResourceUnits)]
    public double? PropellantAmount { get; set; }

    /// <summary>What the pack holds when full, so a reader can draw a fraction
    /// without knowing the model.</summary>
    [SitrepUnit(Units.ResourceUnits)]
    public double? PropellantCapacity { get; set; }

    /// <summary>Whether this kerbal has a jetpack at all: without one the
    /// propellant figures describe nothing.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? HasJetpack { get; set; }

    /// <summary>Whether the jetpack is switched on (KSP's <c>KerbalEVA.JetpackDeployed</c>).</summary>
    [SitrepUnit(Units.Flag)]
    public bool? JetpackDeployed { get; set; }

    /// <summary>Whether the pack is firing right now, which is the only signal
    /// that a kerbal is under thrust.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? JetpackIsThrusting { get; set; }

    /// <summary>Whether the kerbal is on a ladder (KSP's <c>KerbalEVA.OnALadder</c>).</summary>
    [SitrepUnit(Units.Flag)]
    public bool? OnALadder { get; set; }

    /// <summary>Whether the suit's helmet lamp is on (KSP's <c>KerbalEVA.lampOn</c>).</summary>
    [SitrepUnit(Units.Flag)]
    public bool? LampOn { get; set; }

    /// <summary>KSP's own visor state name, from <c>KerbalEVA.VisorState</c>.</summary>
    [SitrepUnit(Units.Text)]
    public string? VisorState { get; set; }

    /// <summary>
    /// Whether removing the helmet here would kill this kerbal, from
    /// <c>KerbalEVA.WillDieWithoutHelmet()</c>.
    ///
    /// <para>Nothing else on the wire says whether the place a kerbal is
    /// standing in is survivable without a helmet.</para>
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? WillDieWithoutHelmet { get; set; }

    /// <summary>Whether the helmet can come off here and now, from
    /// <c>KerbalEVA.CanSafelyRemoveHelmet()</c>. A stricter test than
    /// <see cref="WillDieWithoutHelmet"/>.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? CanSafelyRemoveHelmet { get; set; }

    /// <summary>
    /// KSP's own words for why the helmet cannot come off, passed through
    /// verbatim from <c>KerbalEVA.HelmetUnsafeReason</c>, or <c>null</c> when it
    /// can.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? HelmetUnsafeReason { get; set; }
}

/// <summary>
/// Every kerbal currently outside a craft.
///
/// <para>A channel of its own so that a kerbal stepping out does not change
/// what the vessel channels report: those stay with the craft they left, and
/// this carries what is true of the kerbal.</para>
///
/// <para>An empty list is a real reading: nobody is outside. The channel is
/// absent only before anything has been captured.</para>
/// </summary>
/// <category>Crew</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("eva.crew")]
public class EvaCrew
{
    /// <summary>How many kerbals are outside, so a reader need not count to
    /// know whether to draw anything.</summary>
    [SitrepUnit(Units.Count)]
    public int Count { get; set; }

    /// <summary>One entry per kerbal on EVA. Never null; empty when nobody is outside.</summary>
    public List<EvaKerbal> Kerbals { get; set; } = new();
}
