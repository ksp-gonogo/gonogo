using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// One mode: its name, when it is on, whether it answers for the craft and the
/// kind of timeline it has. An Uplink lists its modes in <see cref="UplinkManifest.Modes"/>,
/// and a client with no mod half sends one as the arguments to
/// <c>mode.declare</c>.
///
/// <para><see cref="Activation"/> is one of <c>"always"</c> (on in every
/// scene), <c>"scene"</c> (on while the game is in one of <see cref="Scenes"/>)
/// and <c>"entered"</c> (on from <c>mode.enter</c> until <c>mode.exit</c>, and
/// only while the game is in one of <see cref="Scenes"/> when any are named).
/// When several modes are on, the one with the lowest <see cref="Order"/> is
/// the mode the dashboard is in.</para>
///
/// <para><see cref="Timeline"/> is one of <c>"none"</c>, <c>"scrub"</c> (moved
/// by <c>mode.timeline.seek</c> only) and <c>"playback"</c> (also played and
/// paused).</para>
///
/// <para><see cref="Answers"/> is one of <c>"nothing"</c> and <c>"craft"</c>.
/// A mode answers for the whole craft or for none of it: while a mode that
/// answers <c>"craft"</c> is on and has supplied anything, a screen reads every
/// Topic about the game from the mode, and a Topic the mode has no value for
/// is not known. Only the dashboard's own Topics (<c>mode.</c>, <c>system.</c>,
/// <c>host.</c> and <c>settings.</c>) stay the live game's.</para>
///
/// <para>A mode that answers nothing and has no timeline leaves the dashboard
/// showing the live game. The mode <c>live</c> is that mode, always on at
/// order 1000.</para>
/// </summary>
/// <category>Modes</category>
/// <categoryDescription>
/// What the dashboard shows other than the live game: the modes an Uplink
/// declares, the mode that is on, its timeline, and the commands that enter a
/// mode and move its timeline.
/// </categoryDescription>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("mode.declare", Delay = DelayRole.TrueNow, AllowMetaVantage = true, Summary = "Declare a mode from a client that has no mod half.")]
public class ModeDeclaration
{
    /// <summary>The mode's id, such as <c>replay</c>. An Uplink's own mode starts with the Uplink's id and a dot.</summary>
    [SitrepUnit(Units.Id)]
    public string Id { get; set; } = "";

    /// <summary>The mode's name as the operator reads it, such as "Replay".</summary>
    [SitrepUnit(Units.Text)]
    public string Name { get; set; } = "";

    /// <summary>Lower wins when several modes are on. Zero takes 50.</summary>
    [SitrepUnit(Units.Count)]
    public int Order { get; set; }

    /// <summary><c>"always"</c>, <c>"scene"</c> or <c>"entered"</c>.</summary>
    [SitrepUnit(Units.Enumeration)]
    public string Activation { get; set; } = "";

    /// <summary>KSP scene names, such as <c>"FLIGHT"</c> or <c>"EDITOR"</c>. Required for <c>"scene"</c>; for <c>"entered"</c> it limits where the mode can be entered and stays on.</summary>
    [SitrepUnit(Units.Enumeration)]
    public List<string> Scenes { get; set; } = new();

    /// <summary>What the mode answers for: <c>"craft"</c> or <c>"nothing"</c>. Empty reads as <c>"nothing"</c>.</summary>
    [SitrepUnit(Units.Id)]
    public string Answers { get; set; } = "nothing";

    /// <summary>True when the mode's values are worked out by a model, such as a predicted flight. False when they were observed in a game at some time, such as a recording.</summary>
    [SitrepUnit(Units.Flag)]
    public bool Modelled { get; set; }

    /// <summary><c>"none"</c>, <c>"scrub"</c> or <c>"playback"</c>.</summary>
    [SitrepUnit(Units.Enumeration)]
    public string Timeline { get; set; } = "";
}

/// <summary>One declared mode as <c>system.modes</c> lists it.</summary>
/// <category>Modes</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class ModeListing
{
    /// <summary>The mode as it was declared.</summary>
    public ModeDeclaration Declaration { get; set; } = new();

    /// <summary>The id of the Uplink that declared the mode, <c>"gonogo"</c> for one of Gonogo's own, or <c>"client"</c> for one declared with <c>mode.declare</c>.</summary>
    [SitrepUnit(Units.Id)]
    public string Owner { get; set; } = "";

    /// <summary>Whether the mode's activation holds now. The mode the dashboard is in is the eligible one with the lowest order, named by <c>mode.state</c>.</summary>
    [SitrepUnit(Units.Flag)]
    public bool Eligible { get; set; }
}

/// <summary>
/// Every declared mode, lowest order first. Useful for listing the modes an
/// operator can enter. Never delayed by signal delay.
/// </summary>
/// <category>Modes</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("system.modes")]
public class ModesModel
{
    /// <summary>The declared modes, lowest order first.</summary>
    public List<ModeListing> Modes { get; set; } = new();
}

/// <summary>A moment on a mode's timeline the operator can jump to, such as a stage of a recorded flight.</summary>
/// <category>Modes</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class ModeMark
{
    /// <summary>The moment.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double Ut { get; set; }

    /// <summary>What happens at the moment, such as "Node 1".</summary>
    [SitrepUnit(Units.Text)]
    public string Label { get; set; } = "";
}

/// <summary>One value a mode's sections set for the mode's source to read, such as the steps of a plan.</summary>
/// <category>Modes</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class ModeInput
{
    /// <summary>The input's name within its mode.</summary>
    [SitrepUnit(Units.Id)]
    public string Key { get; set; } = "";

    /// <summary>The value, as text the mode's own code reads. JSON for anything structured.</summary>
    [SitrepUnit(Units.Text)]
    public string Value { get; set; } = "";
}

/// <summary>
/// The stretch of time a mode covers and where every synced screen is in it.
///
/// <para>While <see cref="Playing"/> is true the position moves at
/// <see cref="Rate"/> seconds of the timeline per real second, and
/// <see cref="AtUt"/> is where it was when this value was sent: a screen
/// carries it forward from the moment it received the value. The value is sent
/// again about once a second while playing and at every control, and playing
/// stops at <see cref="EndUt"/>.</para>
/// </summary>
/// <category>Modes</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class ModeTimelineState
{
    /// <summary>The first moment the timeline covers.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double StartUt { get; set; }

    /// <summary>The last moment the timeline covers.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double EndUt { get; set; }

    /// <summary>The moment every synced screen shows, as of when this value was sent.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double AtUt { get; set; }

    /// <summary>True while the timeline plays.</summary>
    [SitrepUnit(Units.Flag)]
    public bool Playing { get; set; }

    /// <summary>Seconds of the timeline played per real second.</summary>
    [SitrepUnit(Units.Ratio)]
    public double Rate { get; set; }

    /// <summary>The rates the operator can pick from. Empty for a timeline that does not play.</summary>
    [SitrepUnit(Units.Ratio)]
    public List<double> Rates { get; set; } = new();

    /// <summary>Moments the operator can jump to, earliest first.</summary>
    public List<ModeMark> Marks { get; set; } = new();

    /// <summary>The moment that counts as T+0, so times read as mission time. Null reads times from <see cref="StartUt"/>.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? LaunchUt { get; set; }
}

/// <summary>
/// The mode the dashboard is in, the Topics it answers, its inputs and its
/// timeline. Every screen of a game reads the same value, so they show the
/// same mode at the same moment. Never delayed by signal delay.
///
/// <para>The mod decides the mode: the eligible mode with the lowest order.
/// The values a mode answers with do not come from the mod. They are supplied
/// by the mode's source on the hosting screen, each frame carrying the mode's
/// id in <see cref="Meta.Mode"/>.</para>
/// </summary>
/// <category>Modes</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("mode.state")]
public class ModeStateModel
{
    /// <summary>The id of the mode the dashboard is in. <c>"live"</c> when no other mode is on.</summary>
    [SitrepUnit(Units.Id)]
    public string Mode { get; set; } = "";

    /// <summary>The mode's name as the operator reads it.</summary>
    [SitrepUnit(Units.Text)]
    public string Name { get; set; } = "";

    /// <summary>What the mode answers for: <c>"craft"</c> or <c>"nothing"</c>. <c>"nothing"</c> in <c>live</c>.</summary>
    [SitrepUnit(Units.Id)]
    public string Answers { get; set; } = "nothing";

    /// <summary>True when the mode's values are worked out by a model. False when they were observed in a game at some time.</summary>
    [SitrepUnit(Units.Flag)]
    public bool Modelled { get; set; }

    /// <summary>The mode's inputs, in the order they were first set.</summary>
    public List<ModeInput> Inputs { get; set; } = new();

    /// <summary>The mode's timeline, or null while it has none: the mode declares none, or its source has not yet said what stretch of time it covers.</summary>
    public ModeTimelineState? Timeline { get; set; }

    /// <summary>Why the mode has no timeline, in the source's words, such as "No recording chosen". Empty when there is a timeline or nothing has been said.</summary>
    [SitrepUnit(Units.Text)]
    public string NoTimeline { get; set; } = "";

    /// <summary>A number that rises each time the mode that is on changes, so a source can tell a mode entered again from one that stayed on.</summary>
    [SitrepUnit(Units.Count)]
    public int Entry { get; set; }
}

/// <summary>
/// Names a mode. Arguments to <c>mode.enter</c> and <c>mode.exit</c>.
///
/// <para><c>mode.enter</c> turns on a mode whose activation is
/// <c>"entered"</c>, replacing any other entered mode, and is refused outside
/// the mode's scenes. <c>mode.exit</c> turns it off. Never delayed by signal
/// delay.</para>
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("mode.enter", Delay = DelayRole.TrueNow, AllowMetaVantage = true, Summary = "Turn on a mode the operator enters.")]
[SitrepCommand("mode.exit", Delay = DelayRole.TrueNow, AllowMetaVantage = true, Summary = "Turn off a mode the operator entered.")]
public class ModeRefArgs
{
    /// <summary>The mode's id.</summary>
    [SitrepUnit(Units.Id)]
    public string Mode { get; set; } = "";
}

/// <summary>
/// Move a mode's timeline to a moment. Arguments to <c>mode.timeline.seek</c>.
/// The moment is held within the timeline's range. Refused unless the named
/// mode is the mode the dashboard is in and it has a timeline. Never delayed
/// by signal delay.
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("mode.timeline.seek", Delay = DelayRole.TrueNow, AllowMetaVantage = true, Summary = "Move the mode's timeline to a moment.")]
public class ModeSeekArgs
{
    /// <summary>The mode's id.</summary>
    [SitrepUnit(Units.Id)]
    public string Mode { get; set; } = "";

    /// <summary>The moment to move to.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double Ut { get; set; }
}

/// <summary>
/// Play a mode's timeline from where it is. Arguments to
/// <c>mode.timeline.play</c>. Refused unless the named mode is the mode the
/// dashboard is in and its timeline plays back. Playing from the end starts
/// again from the start. Never delayed by signal delay.
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("mode.timeline.play", Delay = DelayRole.TrueNow, AllowMetaVantage = true, Summary = "Play the mode's timeline.")]
public class ModePlayArgs
{
    /// <summary>The mode's id.</summary>
    [SitrepUnit(Units.Id)]
    public string Mode { get; set; } = "";

    /// <summary>Seconds of the timeline to play per real second. Zero keeps the rate it has.</summary>
    [SitrepUnit(Units.Ratio)]
    public double Rate { get; set; }
}

/// <summary>
/// Hold a mode's timeline where it is. Arguments to
/// <c>mode.timeline.pause</c>. Refused unless the named mode is the mode the
/// dashboard is in and it has a timeline. With a rate, the timeline is also
/// set to play at that rate when it is next played, so a rate is chosen on a
/// held timeline without moving it. Never delayed by signal delay.
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("mode.timeline.pause", Delay = DelayRole.TrueNow, AllowMetaVantage = true, Summary = "Hold the mode's timeline where it is.")]
public class ModePauseArgs
{
    /// <summary>The mode's id.</summary>
    [SitrepUnit(Units.Id)]
    public string Mode { get; set; } = "";

    /// <summary>Seconds of the timeline to play per real second once it is played again. Zero keeps the rate it has.</summary>
    [SitrepUnit(Units.Ratio)]
    public double Rate { get; set; }
}

/// <summary>
/// Set one of a mode's inputs. Arguments to <c>mode.setInput</c>. An empty
/// value removes the input. A mode keeps its inputs while it is off, so it
/// comes back on with them. Never delayed by signal delay.
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("mode.setInput", Delay = DelayRole.TrueNow, AllowMetaVantage = true, Summary = "Set one of a mode's inputs.")]
public class ModeInputArgs
{
    /// <summary>The mode's id.</summary>
    [SitrepUnit(Units.Id)]
    public string Mode { get; set; } = "";

    /// <summary>The input's name within the mode.</summary>
    [SitrepUnit(Units.Id)]
    public string Key { get; set; } = "";

    /// <summary>The value, or empty to remove the input.</summary>
    [SitrepUnit(Units.Text)]
    public string Value { get; set; } = "";
}

/// <summary>
/// Say what stretch of time a mode covers. Arguments to
/// <c>mode.timeline.setRange</c>, sent by the mode's source once it knows.
/// Refused unless the named mode is the mode the dashboard is in and it
/// declares a timeline.
///
/// <para>An <see cref="EndUt"/> at or before <see cref="StartUt"/> says the
/// mode has no timeline for now, and <see cref="NoTimeline"/> says why. A new
/// range keeps the position the timeline was at when it lies inside the range,
/// and otherwise starts at <see cref="StartUt"/>. Never delayed by signal
/// delay.</para>
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("mode.timeline.setRange", Delay = DelayRole.TrueNow, AllowMetaVantage = true, Summary = "Say what stretch of time the mode covers.")]
public class ModeRangeArgs
{
    /// <summary>The mode's id.</summary>
    [SitrepUnit(Units.Id)]
    public string Mode { get; set; } = "";

    /// <summary>The first moment the timeline covers.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double StartUt { get; set; }

    /// <summary>The last moment the timeline covers.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double EndUt { get; set; }

    /// <summary>The moment that counts as T+0, or null to read times from <see cref="StartUt"/>.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? LaunchUt { get; set; }

    /// <summary>Moments the operator can jump to.</summary>
    public List<ModeMark> Marks { get; set; } = new();

    /// <summary>The rates the operator can pick from. Empty takes 1, 10, 100 and 1000 for a timeline that plays back.</summary>
    [SitrepUnit(Units.Ratio)]
    public List<double> Rates { get; set; } = new();

    /// <summary>Why there is no timeline, when the range is empty.</summary>
    [SitrepUnit(Units.Text)]
    public string NoTimeline { get; set; } = "";
}
