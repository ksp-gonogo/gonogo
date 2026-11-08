#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// What a quicksave wrote: the save it made and the universal time it holds.
/// The reply to <c>ksp.quicksave</c>.
/// </summary>
/// <category>Flights</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class SaveWritten
{
    /// <summary>Identifies the save, the value <see cref="SaveSummary.SaveId"/> carries.</summary>
    [SitrepUnit(Units.Id)]
    public string SaveId { get; set; } = "";

    /// <summary>The universal time the save holds.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double Ut { get; set; }
}

/// <summary>
/// A quickload the game has accepted and will carry out after a short hold. The
/// reply to <c>ksp.quickload</c>; what became of it arrives on
/// <c>ksp.gameLoaded</c> under the same <see cref="LoadId"/>.
/// </summary>
/// <category>Flights</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class LoadScheduled
{
    /// <summary>Identifies the save, the value <see cref="SaveSummary.SaveId"/> carries.</summary>
    [SitrepUnit(Units.Id)]
    public string SaveId { get; set; } = "";

    /// <summary>The universal time the save holds.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double SaveUt { get; set; }

    /// <summary>Matches this load to its <see cref="GameLoaded.LoadId"/>.</summary>
    [SitrepUnit(Units.Id)]
    public string LoadId { get; set; } = "";
}

/// <summary>
/// One save on disk, as file facts only: nothing about the craft it holds.
/// </summary>
/// <category>Flights</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class SaveSummary
{
    /// <summary>Identifies this file on disk at this moment. A file that has been rewritten since has another id.</summary>
    [SitrepUnit(Units.Id)]
    public string SaveId { get; set; } = "";

    /// <summary>The universal time the save holds.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double Ut { get; set; }
}

/// <summary>
/// The quicksave slot of the loaded game and the save it replaced. Null when no
/// game is loaded. Useful for showing the operator what a quickload would return
/// to and for offering the previous save after a stray quicksave. Sent only when
/// it changes, and at no delay at any command centre: a save is a file outside
/// the universe.
/// </summary>
/// <category>Flights</category>
[SitrepContract]
[SitrepTopic("ksp.saves", DisplayName = "Saves")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class SaveSlots
{
    /// <summary>The quicksave slot, or null when this game has none.</summary>
    public SaveSummary? Quicksave { get; set; }

    /// <summary>The slot as it stood before the last quicksave from mission control, or null when there has been none.</summary>
    public SaveSummary? PreviousQuicksave { get; set; }
}

/// <summary>
/// A quickload ending, one way or the other. Useful for telling every screen
/// what just happened to the game and who asked for it. Delivered at no delay,
/// on every connection subscribed when it happens.
/// </summary>
/// <category>Flights</category>
[SitrepContract]
[SitrepTopic("ksp.gameLoaded", DisplayName = "Game loaded")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class GameLoaded
{
    /// <summary>The save was loaded and the game is running in it.</summary>
    public const string Loaded = "loaded";

    /// <summary>The save could not be loaded and the game has not changed.</summary>
    public const string Failed = "failed";

    /// <summary>A scene change overtook the hold, so the load did not run.</summary>
    public const string Cancelled = "cancelled";

    /// <summary>The <see cref="LoadScheduled.LoadId"/> this answers.</summary>
    [SitrepUnit(Units.Id)]
    public string LoadId { get; set; } = "";

    /// <summary><see cref="Loaded"/>, <see cref="Failed"/> or <see cref="Cancelled"/>. Treat a value you do not know as a load that did not happen.</summary>
    [SitrepUnit(Units.Id)]
    public string Outcome { get; set; } = "";

    /// <summary>Why a load failed. Null unless <see cref="Outcome"/> is <see cref="Failed"/>.</summary>
    [SitrepUnit(Units.Text)]
    public string? FailReason { get; set; }

    /// <summary>The universal time the save holds.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double SaveUt { get; set; }

    /// <summary>The universal time the game had reached when the load was asked for, which a screen compares with <see cref="SaveUt"/> to say how far it moved.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double FromUt { get; set; }

    /// <summary>The screen that asked for it, as <see cref="QuickloadArgs.RequestedBy"/> said. Empty when the main screen asked.</summary>
    [SitrepUnit(Units.Text)]
    public string RequestedBy { get; set; } = "";
}
