using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// One kerbal currently outside a craft, on that kerbal's own
/// <c>eva.kerbal.&lt;vessel id&gt;.state</c> Topic.
///
/// <para>The Topic is recorded on the kerbal's own node, so it reaches a command centre
/// by the kerbal's own link and signal delay. A stock kerbal has no antenna, so its
/// state is held; a kerbal carrying a radio from a mod is live. The craft it left has
/// no say either way.</para>
///
/// <para>A kerbal on EVA is a vessel in KSP's model, with its own id, so it
/// already appears on <c>trackingStation.catalog</c> and on its own per-craft Topics
/// (<c>trackingStation.vessel.&lt;guid&gt;.link</c> and <c>.resources</c>).
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
    /// <summary>The kerbal's own vessel id, the same guid <c>trackingStation.catalog</c>
    /// carries for it.</summary>
    [SitrepUnit(Units.Id)]
    public string? KerbalVesselId { get; set; }

    /// <summary>
    /// The vessel id of the craft this kerbal stepped out of, or <c>null</c>
    /// when that is not known (the step-out was not recorded, or the craft has
    /// since gone).
    ///
    /// <para>This is the vessel Gonogo goes on reporting as active while they
    /// are outside, so a client that follows the active vessel sees no
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
    [SitrepSampleKind(SampleKind.Continuous)]
    public double? PropellantAmount { get; set; }

    /// <summary>What the pack holds when full, so a client can draw a fraction
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

    /// <summary>
    /// The science results this kerbal is holding, such as a surface sample or an EVA
    /// report, which are on no other Topic: <c>science.experiments</c> lists the
    /// active vessel's results and a kerbal outside is not that vessel. Empty when the
    /// kerbal holds none, and <c>null</c> when it could not be read. A kerbal that is not
    /// loaded is read from the game's saved state, so its results are listed all the same.
    /// </summary>
    public List<EvaHeldData>? HeldData { get; set; }
}

/// <summary>
/// One science result a kerbal on EVA is holding, in <see cref="EvaKerbal.HeldData"/>.
/// </summary>
/// <category>Crew</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class EvaHeldData
{
    /// <summary>The research subject's id (<c>ScienceSubject.id</c>), the same key
    /// <c>science.archive</c> lists it under.</summary>
    [SitrepUnit(Units.Id)]
    public string? SubjectId { get; set; }

    /// <summary>The result's title, for example "Surface Sample from The Mun's
    /// Midlands".</summary>
    [SitrepUnit(Units.Text)]
    public string? Title { get; set; }

    /// <summary>The size of the result.</summary>
    [SitrepUnit(Units.Mits)]
    public double? DataAmount { get; set; }
}

/// <summary>
/// One kerbal listed on <c>eva.crew</c>: who is outside and which craft they left,
/// enough to find the kerbal's own <c>eva.kerbal.&lt;vessel id&gt;.state</c> Topic.
/// </summary>
/// <category>Crew</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class EvaCrewMember
{
    /// <summary>The kerbal's own vessel id, the key of its <c>eva.kerbal.&lt;vessel id&gt;.state</c>
    /// Topic and the guid <c>trackingStation.catalog</c> carries for it.</summary>
    [SitrepUnit(Units.Id)]
    public string? KerbalVesselId { get; set; }

    /// <summary>The vessel id of the craft this kerbal stepped out of, or <c>null</c> when
    /// that is not known (the step-out was not recorded, or the craft has since gone).</summary>
    [SitrepUnit(Units.Id)]
    public string? ParentVesselId { get; set; }

    /// <summary>The kerbal's name, from the EVA vessel's <c>GetName()</c>.</summary>
    [SitrepUnit(Units.Text)]
    public string? Name { get; set; }
}

/// <summary>
/// The roster of kerbals currently outside a craft, so a client can find each one's own
/// <c>eva.kerbal.&lt;vessel id&gt;.state</c> Topic. The suit state is on those Topics, not here.
///
/// <para>The roster is a fact the home command holds, so it is not held by the link of the
/// craft a kerbal left or of any kerbal.</para>
///
/// <para>An empty list is a real reading: nobody is outside. The Topic has no
/// reading only until its first sample arrives.</para>
/// </summary>
/// <category>Crew</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("eva.crew")]
public class EvaCrew
{
    /// <summary>How many kerbals are outside, so a client need not count to
    /// know whether to draw anything.</summary>
    [SitrepUnit(Units.Count)]
    public int Count { get; set; }

    /// <summary>One entry per kerbal on EVA. Never null; empty when nobody is outside.</summary>
    public List<EvaCrewMember> Kerbals { get; set; } = new();
}
