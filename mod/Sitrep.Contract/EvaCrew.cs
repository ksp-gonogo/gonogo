using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// One kerbal currently outside a craft, on the <c>eva.crew</c> channel.
///
/// <para>A kerbal on EVA is a vessel in KSP's model, with its own id, so it
/// already appears on <c>system.vessels</c> and gets its own <c>fleet.</c> node.
/// What is here and nowhere else is the SUIT: what it is carrying, what it can
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
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class EvaKerbal
{
    /// <summary>The kerbal's own vessel id, the same guid <c>system.vessels</c> carries for it.</summary>
    [SitrepUnit(Units.Id)]
    public string? KerbalVesselId { get; set; }

    /// <summary>
    /// The craft this kerbal stepped out of, or <c>null</c> when that is not
    /// known (a kerbal already outside when the save was loaded by a build that
    /// did not record it, or one whose craft has since gone).
    ///
    /// <para>This is the vessel gonogo goes on reporting as active while they
    /// are outside, so a reader that follows the active vessel sees no
    /// discontinuity when a kerbal steps out.</para>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? ParentVesselId { get; set; }

    [SitrepUnit(Units.Text)]
    public string? Name { get; set; }

    /// <summary>KSP's own situation name for the kerbal (<c>FLYING</c>, <c>LANDED</c>, ...).</summary>
    [SitrepUnit(Units.Text)]
    public string? Situation { get; set; }

    /// <summary>EVA propellant remaining in the pack.</summary>
    [SitrepUnit(Units.ResourceUnits)]
    public double? PropellantAmount { get; set; }

    /// <summary>What the pack holds when full, so a reader can draw a fraction without knowing the model.</summary>
    [SitrepUnit(Units.ResourceUnits)]
    public double? PropellantCapacity { get; set; }

    /// <summary>Whether this kerbal has a jetpack at all: without one the propellant figures describe nothing.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? HasJetpack { get; set; }

    [SitrepUnit(Units.Flag)]
    public bool? JetpackDeployed { get; set; }

    /// <summary>Whether the pack is firing right now, which is the only signal that a kerbal is under thrust.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? JetpackIsThrusting { get; set; }

    [SitrepUnit(Units.Flag)]
    public bool? OnALadder { get; set; }

    [SitrepUnit(Units.Flag)]
    public bool? LampOn { get; set; }

    /// <summary>KSP's own visor state name.</summary>
    [SitrepUnit(Units.Text)]
    public string? VisorState { get; set; }

    /// <summary>
    /// Whether removing the helmet here would KILL this kerbal.
    ///
    /// <para>The sharpest fact on this channel, and the reason it is worth a
    /// channel: nothing else on the wire says whether the place a kerbal is
    /// standing in is survivable unsuited.</para>
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? WillDieWithoutHelmet { get; set; }

    /// <summary>Whether the helmet can come off here and now, which is a stricter question than surviving it.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? CanSafelyRemoveHelmet { get; set; }

    /// <summary>
    /// KSP's OWN words for why the helmet cannot come off, or <c>null</c> when
    /// it can.
    ///
    /// <para>Passed through verbatim rather than re-worded: the game already
    /// phrases this for a player, and inventing a second vocabulary for the
    /// same fact would only let the two drift.</para>
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? HelmetUnsafeReason { get; set; }
}

/// <summary>
/// Every kerbal currently outside a craft.
///
/// <para>ADDITIVE, and deliberately a channel of its own: a kerbal stepping out
/// must not change what the vessel channels report. The vantage stays with the
/// craft they left, so nothing reading the vessel's stream sees a
/// discontinuity, and this carries what is true of the kerbal instead.</para>
///
/// <para>An empty list is a real answer: nobody is outside. The channel is
/// absent only before anything has been captured.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("eva.crew")]
public class EvaCrew
{
    /// <summary>How many kerbals are outside, so a reader need not count to know whether to draw anything.</summary>
    [SitrepUnit(Units.Count)]
    public int Count { get; set; }

    public List<EvaKerbal> Kerbals { get; set; } = new();

    public PayloadMeta Meta { get; set; } = new();
}
