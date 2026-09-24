#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif
using System.Collections.Generic;

namespace Sitrep.Contract;

/// <summary>
/// Which kind of condition a SCET alarm watches for.
///
/// <para>Every alarm has a vantage, so a kind is only about WHAT is watched.
/// A contract parameter has no member here yet because it reads a list-shaped
/// Topic and a dotted path cannot index a list, so it needs a matcher of its
/// own rather than a threshold's.</para>
/// </summary>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum ScetAlarmConditionKind
{
    /// <summary>An instant on the craft's own clock, as a universal time.</summary>
    Time,

    /// <summary>
    /// A value aboard the craft crossing a number the operator chose, compared
    /// against the reading the simulation actually holds rather than against the
    /// one the command centre has been told.
    ///
    /// <para>This is the kind that cannot be done anywhere else. A time alarm
    /// needs only a clock, and a client has one; a threshold needs the craft's
    /// true state, which reaches the ground a light-time late and by then is no
    /// longer the answer to "is it above 100 km NOW".</para>
    /// </summary>
    Threshold,
}

/// <summary>
/// How a threshold condition compares the reading to the operator's number.
///
/// <para>The same six the client's own alarm list offers, so an alarm armed on
/// the command vantage and the same alarm armed on the craft's clock mean the
/// same thing and can be checked against each other at zero delay.</para>
/// </summary>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum ScetAlarmThresholdOp
{
    /// <summary>Reading is greater than the threshold.</summary>
    GreaterThan,

    /// <summary>Reading is greater than or equal to the threshold.</summary>
    GreaterThanOrEqual,

    /// <summary>Reading is less than the threshold.</summary>
    LessThan,

    /// <summary>Reading is less than or equal to the threshold.</summary>
    LessThanOrEqual,

    /// <summary>
    /// Reading equals the threshold exactly.
    ///
    /// <para>Offered for parity with the client's list, and a knife edge on
    /// anything continuous: the reading is a sample, and under warp the samples
    /// are thousands of game-seconds apart, so a craft can pass straight through
    /// the value without one landing on it. An inequality is almost always the
    /// condition an operator actually means.</para>
    /// </summary>
    Equal,

    /// <summary>Reading differs from the threshold. The inverse of <see cref="Equal"/>, and inherits its caveat.</summary>
    NotEqual,
}

/// <summary>
/// Where an armed SCET alarm has got to.
///
/// <para>A latch, not a level: <see cref="Fired"/> is reached once and stays,
/// so a condition that keeps holding cannot stop the warp again on the next
/// tick.</para>
/// </summary>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum ScetAlarmState
{
    /// <summary>Watching. The condition has not been met.</summary>
    Armed,

    /// <summary>The condition was met, warp was stopped, and the notice went out.</summary>
    Fired,

    /// <summary>
    /// The craft the condition watches no longer exists, so the alarm can never
    /// come due.
    ///
    /// <para>Only a threshold reaches this: a time condition has no subject to
    /// lose, because universal time belongs to the game. It is on the roster
    /// because the simulation knows the craft is gone and the command centre
    /// does not, and a row that will never fire must read as dead rather than as
    /// pending forever.</para>
    /// </summary>
    Unreachable,
}

/// <summary>
/// What a SCET alarm watches for, on the craft's own clock.
///
/// <para>A discriminated shape: <see cref="Kind"/> says which of the fields
/// below carry meaning. For <see cref="ScetAlarmConditionKind.Time"/> that is
/// <see cref="Ut"/> and <see cref="LeadSeconds"/>; for
/// <see cref="ScetAlarmConditionKind.Threshold"/> it is <see cref="Topic"/>,
/// <see cref="FieldPath"/>, <see cref="Op"/>, <see cref="Threshold"/> and
/// <see cref="SustainSeconds"/>.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class ScetAlarmCondition
{
    [SitrepUnit(Units.Enumeration)]
    public ScetAlarmConditionKind Kind { get; set; } = ScetAlarmConditionKind.Time;

    /// <summary>
    /// The instant the alarm is set for, as a universal time on the CRAFT's
    /// clock rather than on the clock the command centre is reading.
    ///
    /// <para>The difference between the two is the one-way light time, and it
    /// moves continuously as the craft does. A client that subtracts it once,
    /// at the moment the operator clicks, is right only for that instant; this
    /// field is the instant itself, compared against the game's own clock every
    /// tick, so the answer stays right however the geometry changes between
    /// arming and firing.</para>
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double Ut { get; set; }

    /// <summary>
    /// How long before <see cref="Ut"/> warp is stopped, in seconds, so the
    /// operator has real time in hand before the instant they set the alarm for.
    /// Zero stops the warp at the instant itself.
    ///
    /// <para>The stop and the notice are two separate moments: warp halts at
    /// <c>Ut - LeadSeconds</c>, and the alarm fires at <c>Ut</c>, which arrives
    /// in real time because the warp is already stopped.</para>
    /// </summary>
    [SitrepUnit(Units.Seconds)]
    public double LeadSeconds { get; set; }

    /// <summary>
    /// Threshold only: the Topic whose payload carries the value to watch, as
    /// the client spells a Topic (<c>"vessel.flight"</c>).
    ///
    /// <para>A Topic and a path into it, rather than one flat key. The flat key
    /// space is the client's own and has no meaning to the simulation, which
    /// holds Topics and the payloads it builds for them; addressing a reading
    /// the way the wire addresses it is what lets an operator point at a value
    /// they can already see on screen.</para>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string Topic { get; set; } = "";

    /// <summary>
    /// Threshold only: the dotted path to the value inside
    /// <see cref="Topic"/>'s payload (<c>"altitudeAsl"</c>,
    /// <c>"relativePosition.x"</c>). Empty addresses the payload itself, which
    /// is never a number, so it never matches.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string FieldPath { get; set; } = "";

    /// <summary>Threshold only: how the reading is compared to <see cref="Threshold"/>.</summary>
    [SitrepUnit(Units.Enumeration)]
    public ScetAlarmThresholdOp Op { get; set; } = ScetAlarmThresholdOp.GreaterThan;

    /// <summary>
    /// Threshold only: the number the operator chose, in whatever unit
    /// <see cref="FieldPath"/> is published in.
    ///
    /// <para>Declared with no unit of its own because it genuinely has none
    /// until the field beside it is resolved: the same field says metres for one
    /// alarm and kilonewtons for the next. A consumer that wants to render it
    /// looks up the unit of the addressed field.</para>
    /// </summary>
    [SitrepUnit(Units.NotApplicable)]
    public double Threshold { get; set; }

    /// <summary>
    /// Threshold only: how long the condition must hold, in seconds, before the
    /// alarm fires. Zero fires on the first reading that matches.
    ///
    /// <para><b>Warp is stopped at the first match, not at the fire.</b> A
    /// sustain window is a span of the craft's time, and under warp one tick
    /// covers thousands of seconds of it, so a window measured across warped
    /// ticks would be satisfied by two samples and mean nothing. Stopping first
    /// is what gives the window real ticks to be measured over. The cost is that
    /// a condition that matches once and then stops matching has still stopped
    /// the warp; that is the fail-safe side to err on, because the operator
    /// keeps their game and loses only the time they were skipping.</para>
    /// </summary>
    [SitrepUnit(Units.Seconds)]
    public double SustainSeconds { get; set; }
}

/// <summary>
/// What a SCET alarm's onboard action does to the craft when the alarm fires.
///
/// <para>A typed member for each stock singleton and one for every custom
/// group, so no name ever crosses the wire. A player may call a custom group
/// "Stage", and two custom groups may share a name, so a name is not an
/// identity: a custom group is addressed by its index in
/// <see cref="ScetAlarmAction.Group"/>, and cannot be read as the stage
/// command however it is labelled.</para>
/// </summary>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum ScetAlarmActionKind
{
    /// <summary>Toggle the custom action group whose index is <see cref="ScetAlarmAction.Group"/>.</summary>
    ActionGroup,

    /// <summary>Activate the next stage.</summary>
    Stage,

    /// <summary>Toggle SAS.</summary>
    Sas,

    /// <summary>Toggle RCS.</summary>
    Rcs,

    /// <summary>Toggle the lights.</summary>
    Lights,

    /// <summary>Toggle the landing gear.</summary>
    Gear,

    /// <summary>Toggle the brakes.</summary>
    Brakes,

    /// <summary>Toggle the abort action group.</summary>
    Abort,
}

/// <summary>
/// One thing the craft does in the frame its alarm fires, as a flight computer
/// would: evaluated aboard, fired aboard, acted aboard.
///
/// <para>Held only by an alarm read at its own subject's vantage. An alarm
/// judged against what a command centre has been told comes due a light-time
/// after the craft passed the condition, and acting on the craft in that same
/// frame would carry the ground's decision to the craft faster than light, so
/// such an arm is refused. A ground-side alarm's action travels as an ordinary
/// command instead.</para>
///
/// <para>Every kind but <see cref="ScetAlarmActionKind.Stage"/> TOGGLES,
/// against the state the craft reports at the moment of the fire, which is
/// what pressing the group's key does.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class ScetAlarmAction
{
    [SitrepUnit(Units.Enumeration)]
    public ScetAlarmActionKind Kind { get; set; } = ScetAlarmActionKind.ActionGroup;

    /// <summary>
    /// <see cref="ScetAlarmActionKind.ActionGroup"/> only: the custom group's
    /// 1-based index, as <c>vessel.control.setActionGroup</c> takes it. Zero for
    /// every other kind.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public int Group { get; set; }
}

/// <summary>
/// One armed SCET alarm as the simulation host holds it: the
/// <c>alarm.scet</c> channel is a bare array of these.
///
/// <para>The roster exists so an operator can see what is still armed after a
/// reconnect, and so a client can disarm an entry it no longer remembers. It is
/// ground-side bookkeeping, a list of things somebody asked for rather than a
/// reading of any craft, which is why the channel does not ride the reveal
/// clock.</para>
/// <internal>
/// Held in memory by <c>Sitrep.Host.Alarms.ScetAlarmRoster</c> and published by
/// <c>Gonogo.KSP.ScetAlarmUplink</c>. Deliberately NOT written to the save,
/// though <c>EvaParentageScenario</c> shows how: the client's own list is the
/// one the operator edits, and two authorities for one list diverge across a
/// quickload. The roster dies with the game session and the client re-arms.
/// Published RAW, so <c>JsonWriter.AppendScetAlarm</c> is what puts it on the
/// wire.
/// </internal>
/// </summary>
[SitrepContract]
[SitrepTopic("alarm.scet", isArray: true)]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class ScetAlarm
{
    /// <summary>
    /// The client's own id for the alarm, minted where the alarm was created and
    /// carried unchanged. Arming an id that is already armed REPLACES it, so a
    /// re-arm is idempotent and a reconnect cannot duplicate a row.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string Id { get; set; } = "";

    /// <summary>What the operator called it. Echoed so a roster row a client no longer recognises can still be named on screen.</summary>
    [SitrepUnit(Units.Text)]
    public string Name { get; set; } = "";

    /// <summary>
    /// The command centre the arm command was sent from, as a
    /// <c>commandCentre.roster</c> id.
    ///
    /// <para>Who ASKED for the alarm, never where it is read. That is
    /// <see cref="Vantage"/>, and the two are separate jobs: this is also the
    /// one field a screen at a different vantage may render, because the
    /// condition and the target would tell it something about a craft faster
    /// than the light carrying it.</para>
    /// <internal>
    /// Resolved by the engine from where the command entered
    /// (<c>AddVantageCommandHandler</c>) rather than taken from the arm
    /// arguments. The dispatch vantage it resolves from is either the session's
    /// <c>SelectedVantage</c> or the per-command override on the request
    /// envelope, and BOTH are client-supplied, so neither is trusted: each is
    /// checked against <c>ChannelEngine.IsSelectableVantage</c>, which requires a
    /// currently-active command centre (or the always-allowed default). A
    /// set-vantage naming anything else keeps the prior vantage, and a command
    /// override naming anything else is refused with <c>unknown-vantage</c>
    /// rather than falling back, so this can only ever name a centre that was
    /// real when the alarm was armed.
    /// </internal>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string ArmedBy { get; set; } = "";

    /// <summary>
    /// The place whose knowledge the condition is read against, and therefore
    /// the place that decides WHEN this alarm comes due. A
    /// <c>commandCentre.roster</c> id (<c>"ground:&lt;name&gt;"</c>,
    /// <c>"vessel:&lt;guid&gt;"</c>), or empty, which is read as the alarm's own
    /// <see cref="Subject"/>.
    ///
    /// <para>A vantage that IS the subject reads the craft's true state, so the
    /// alarm comes due at the instant the condition is met. Any other vantage
    /// reads what that place has been told, which is a light-time old and
    /// different everywhere, so the same condition comes due there when the
    /// light carrying it lands. The vantage decides when, never whether.</para>
    ///
    /// <para><b>Distinct from <see cref="ArmedBy"/>, which is provenance.</b>
    /// That says where the arm command came from and nothing else. An operator
    /// at one centre may legitimately ask when ANOTHER centre will know, and
    /// where the command entered cannot express that.</para>
    ///
    /// <para>A place, never a connection. Two operators sharing a command
    /// centre share its knowledge and its answer, and a browser reconnecting is
    /// the same place it was before, so the simulation never learns that
    /// clients exist.</para>
    /// <internal>
    /// Taken from the arm ARGUMENTS rather than resolved from where the command
    /// entered, which is the opposite of <see cref="ArmedBy"/>. Resolved to
    /// <see cref="Subject"/> at arm time when empty, which is what keeps the
    /// rename off a flag day: an older client's arm still lands somewhere
    /// correct. <c>Sitrep.Host.Alarms.ScetAlarmVantage</c> holds the rule, and
    /// which of the two readers an entry gets follows from it.
    /// </internal>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string Vantage { get; set; } = "";

    /// <summary>
    /// What the condition is about: <c>"vessel:&lt;guid&gt;"</c> for a craft, or
    /// <c>"game"</c> for something the whole simulation shares. The same
    /// vocabulary <c>meta.source</c> uses.
    ///
    /// <para>A time condition is always <c>"game"</c>: universal time is the
    /// game's, and a clock has no craft to belong to. A threshold names the
    /// craft, and this is what stops it silently re-aiming when the player
    /// switches vessels: the simulation compares this against the
    /// <c>meta.source</c> stamped on the payload it read, and a reading about
    /// somebody else's craft is not an answer to this alarm's question.</para>
    ///
    /// <para>A threshold on something the save owns rather than a craft is
    /// <c>"game"</c> too, and <c>career.status</c> is the one core publishes:
    /// there is one career, and no vessel switch can change which one is being
    /// read, so there is nothing for a third token to tell apart. That is the
    /// rule for a contributed Topic as well, not a special case for this
    /// one.</para>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string Subject { get; set; } = "game";

    public ScetAlarmCondition Condition { get; set; } = new ScetAlarmCondition();

    [SitrepUnit(Units.Enumeration)]
    public ScetAlarmState State { get; set; } = ScetAlarmState.Armed;

    /// <summary>
    /// The universal time the alarm fired at, or <c>null</c> while it is still
    /// armed. On the craft's clock, like <see cref="ScetAlarmCondition.Ut"/>.
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? FiredAtUt { get; set; }

    /// <summary>
    /// What the craft does when this alarm fires, in order. Empty for an alarm
    /// that only stops the warp and says so. See <see cref="ScetAlarmAction"/>.
    /// </summary>
    public List<ScetAlarmAction> OnFire { get; set; } = new();

    /// <summary>
    /// The craft <see cref="OnFire"/> acts on, as <c>"vessel:&lt;guid&gt;"</c>,
    /// or empty while there are no actions.
    ///
    /// <para>The actions run only if this craft is the one being flown when the
    /// alarm fires, and are withheld otherwise: a time condition belongs to the
    /// game rather than to any craft, so after a vessel switch its actions would
    /// otherwise land on whatever happened to be active.</para>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string ActsOn { get; set; } = "";
}

/// <summary>
/// The notice that a SCET alarm has fired and the warp has been stopped.
///
/// <para><b>It says THAT one fired and WHEN, and deliberately nothing about the
/// craft.</b> The stop is universal, because warp is; the telemetry is not, and
/// stays a light-time behind. So an operator can be told their alarm went off
/// while every reading beside it still shows the craft as it was minutes ago,
/// and this payload carries nothing that would close that gap early. Whatever
/// the craft was doing at <see cref="FiredAtUt"/> arrives when it arrives.</para>
///
/// <para>The id and the instant are the honest minimum. The id is the operator's own
/// handle, which tells them nothing they did not already write down. The instant
/// is inseparable from the stop: without it a warp that halted at one universal
/// time is indistinguishable from one that halted at another, and the operator
/// cannot tell which of two armed alarms stopped them. The other fields say
/// where it was learned and whether its actions were withheld for want of the
/// right craft, and neither is a reading of the craft.</para>
/// <internal>
/// The spec also proposed echoing the condition back. For a time arm that is
/// the instant restated, so it adds nothing; for the threshold arm to come it
/// would be a claim about the craft ("altitude passed 100 km") wearing the
/// operator's own words, and the firing shows true-now while the REASON does
/// not. So the condition is not echoed, here or
/// later, and a client that wants to name the alarm reads the roster.
/// Published RAW: see <c>JsonWriter.AppendScetAlarmFired</c>.
/// </internal>
/// </summary>
[SitrepContract]
[SitrepTopic("alarm.scet.fired")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class ScetAlarmFired
{
    /// <summary>Which alarm, as the <see cref="ScetAlarm.Id"/> it was armed under.</summary>
    [SitrepUnit(Units.Id)]
    public string Id { get; set; } = "";

    /// <summary>The universal time it fired at, on the craft's clock.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double FiredAtUt { get; set; }

    /// <summary>
    /// The place that learned it, echoing the <see cref="ScetAlarm.Vantage"/> it
    /// was armed at.
    ///
    /// <para>Carried rather than left to the client to look up, because a reader
    /// that has to consult the roster first is a reader that will act on the
    /// wrong notice. A notice at the subject's own vantage is a fact about the
    /// craft at the instant it happened; a notice at anywhere else is a
    /// statement about what that place has been told, true only there.</para>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string Vantage { get; set; } = "";

    /// <summary>
    /// Whether the alarm held onboard actions and they were withheld because
    /// the craft named by <see cref="ScetAlarm.ActsOn"/> was not the one being
    /// flown. False for an alarm with no actions.
    ///
    /// <para>Says nothing about how the craft answered an action that WAS sent.
    /// That is a fact aboard the craft, and it reaches the ground the way every
    /// other one does, a light-time later in the craft's own telemetry: this
    /// notice travels at once and must not carry it.</para>
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool ActionsWithheld { get; set; }
}

/// <summary>
/// <c>alarm.scet.arm</c>'s args: register an alarm with the simulation host, or
/// replace one already registered under the same <see cref="Id"/>.
///
/// <para>Never delayed. Arming changes nothing aboard the craft, so there is no
/// light-time fiction to honour, and the same reasoning
/// <c>time.setWarpIndex</c> has always carried applies: this is a control on the
/// simulation, not a signal to a spacecraft. Delayed it would also be
/// unusable, because an alarm for an event less than one light-time away could
/// never be armed in time, and a delayed command is dropped outright during a
/// blackout, which is exactly when a SCET alarm earns its keep.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("alarm.scet.arm", Delay = DelayRole.TrueNow)]
public class ScetAlarmArmArgs
{
    [SitrepUnit(Units.Id)]
    public string Id { get; set; } = "";

    [SitrepUnit(Units.Text)]
    public string Name { get; set; } = "";

    /// <summary>
    /// See <see cref="ScetAlarm.Vantage"/>. Empty is accepted and resolved at
    /// arm time to <see cref="Subject"/>, which is the behaviour every alarm
    /// already had, so a client that names no vantage keeps it.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string Vantage { get; set; } = "";

    /// <summary>See <see cref="ScetAlarm.Subject"/>. Empty is read as <c>"game"</c>.</summary>
    [SitrepUnit(Units.Id)]
    public string Subject { get; set; } = "game";

    public ScetAlarmCondition Condition { get; set; } = new ScetAlarmCondition();

    /// <summary>
    /// See <see cref="ScetAlarm.OnFire"/>. Non-empty only where the alarm is read
    /// at its own subject's vantage and that subject is a craft, or the condition
    /// is a time on the game's clock; any other arm carrying actions is refused
    /// rather than accepted with them dropped.
    /// </summary>
    public List<ScetAlarmAction> OnFire { get; set; } = new();

    /// <summary>
    /// See <see cref="ScetAlarm.ActsOn"/>. A time condition carrying actions
    /// must name the craft the operator means them for. A threshold on a craft
    /// acts on that craft, so empty resolves to its subject and any other craft
    /// is refused.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string ActsOn { get; set; } = "";
}

/// <summary>
/// <c>alarm.scet.disarm</c>'s args: forget the alarm with this id. Silently
/// succeeds for an id the host does not hold, so a client reconciling its list
/// against the roster never has to ask first.
///
/// <para>Never delayed, for the reason its opposite is not: the inverse of an
/// instant act must not be slower than the act.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("alarm.scet.disarm", Delay = DelayRole.TrueNow)]
public class ScetAlarmDisarmArgs
{
    [SitrepUnit(Units.Id)]
    public string Id { get; set; } = "";
}
