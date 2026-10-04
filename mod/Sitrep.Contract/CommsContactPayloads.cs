using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// One command centre's contact plan: for each pair of nodes that could hold a
/// link (a ground station and a craft, or two craft), the windows over the
/// coming hours when that centre predicts nothing blocks it and it is within
/// reach.
///
/// <para>A prediction, and the receiving centre's own. Every craft is reckoned
/// forward from the last orbit that centre has heard it report, so the plan
/// holds nothing the centre could not know: a distant craft's burn moves the
/// plan one light-time after it happened, and a craft the centre has never
/// heard of is not in it. Two centres can hold different plans at the same
/// moment, and each session is sent only the plan of the centre it sits
/// at.</para>
///
/// <para>The live link the game reports always decides what actually gets
/// through; this says when that link is expected to exist. A pair absent from
/// <see cref="Pairs"/> was not predicted at all, which is different from a pair
/// listed with no windows: that one is predicted never to be in contact before
/// its <see cref="CommsContactPair.HorizonUt"/>.</para>
/// <internal>
/// Made by Sitrep.Host.Comms.ReckonedPlan from the craft states
/// CentreHearing has received at that centre, and delivered through
/// Courier.RecordAddressed to that centre alone, zero seconds after it was
/// made: the light-time was spent by the craft states on their way in.
/// </internal>
/// </summary>
/// <category>Comms</category>
[SitrepContract]
[SitrepTopic("comms.contacts")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CommsContacts
{
    /// <summary>The universal time the plan reaches to; nothing is predicted past it.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double HorizonUt { get; set; }

    /// <summary>Every pair predicted, each with its windows.</summary>
    public List<CommsContactPair> Pairs { get; set; } = new List<CommsContactPair>();
}

/// <summary>Two nodes and the windows the plan predicts contact between them.</summary>
/// <category>Comms</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CommsContactPair
{
    /// <summary>One end, in the <c>commandCentre.roster</c> vocabulary: <c>"ground:&lt;name&gt;"</c> or <c>"vessel:&lt;guid&gt;"</c>.</summary>
    [SitrepUnit(Units.Id)]
    public string A { get; set; } = "";

    /// <summary>The other end, in the same vocabulary.</summary>
    [SitrepUnit(Units.Id)]
    public string B { get; set; } = "";

    /// <summary>
    /// The last instant predicted for this pair: the plan's horizon, or sooner
    /// where either end's motion cannot be trusted that far ahead.
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double HorizonUt { get; set; }

    /// <summary>Every window of contact up to <see cref="HorizonUt"/>, in time order. Empty when none is predicted.</summary>
    public List<CommsContactWindow> Windows { get; set; } = new List<CommsContactWindow>();

    /// <summary>
    /// True while either end was last heard of with its orbit still changing.
    /// It is reckoned on the orbit it reported mid-burn, which it has since
    /// left, so these windows are a rough guide until its next report.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool LowConfidence { get; set; }
}

/// <summary>One predicted stretch of contact.</summary>
/// <category>Comms</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CommsContactWindow
{
    /// <summary>When contact begins, or <c>null</c> when it is already open at the plan's start.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? OpenUt { get; set; }

    /// <summary>When contact ends, or <c>null</c> when it is still open at the pair's horizon.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? CloseUt { get; set; }
}
