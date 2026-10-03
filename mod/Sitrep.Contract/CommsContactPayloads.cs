using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The predicted contact plan: for each pair of nodes that could hold a link
/// (a ground station and a craft, or two craft), the windows over the coming
/// hours when nothing blocks it and it is within reach.
///
/// <para>A prediction, from the orbits as they stood when the plan was made.
/// The live link the game reports always decides what actually gets through;
/// this says when that link is expected to exist. A pair absent from
/// <see cref="Pairs"/> was not predicted at all, which is different from a pair
/// listed with no windows: that one is predicted never to be in contact before
/// its <see cref="CommsContactPair.HorizonUt"/>.</para>
///
/// <para>DELAYED, so each command centre receives the plan one of its own
/// light-times after it was made, and so plans from what it could know by
/// then.</para>
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
