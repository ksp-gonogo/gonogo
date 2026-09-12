#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Which kind of condition a SCET alarm watches for.
///
/// <para>A SCET vantage is meaningful exactly where the craft's TRUE state and
/// the state the ground has been told differ, which is why there is no member
/// here for a contract parameter: career bookkeeping is known to the command
/// centre without any link, so there is no gap for a vantage to straddle.</para>
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
    /// <para>Provenance only: a SCET alarm stops the warp for everybody,
    /// because warp is a property of the simulation rather than of any one
    /// vantage. This says who asked for it, never who it applies to.</para>
    /// <internal>
    /// Resolved by the engine from where the command entered
    /// (<c>AddVantageCommandHandler</c>) rather than taken from the arm
    /// arguments, so a client cannot name a centre that is not its own.
    /// </internal>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string ArmedBy { get; set; } = "";

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
/// <para>The two fields are the honest minimum. The id is the operator's own
/// handle, which tells them nothing they did not already write down. The instant
/// is inseparable from the stop: without it a warp that halted at one universal
/// time is indistinguishable from one that halted at another, and the operator
/// cannot tell which of two armed alarms stopped them.</para>
/// <internal>
/// The spec also proposed echoing the condition back. For a time arm that is
/// the instant restated, so it adds nothing; for the threshold arm to come it
/// would be a claim about the craft ("altitude passed 100 km") wearing the
/// operator's own words, and the 2026-09-11 ruling is that the firing shows
/// true-now and the REASON does not. So the condition is not echoed, here or
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
[SitrepCommand("alarm.scet.arm", Delayed = false)]
public class ScetAlarmArmArgs
{
    [SitrepUnit(Units.Id)]
    public string Id { get; set; } = "";

    [SitrepUnit(Units.Text)]
    public string Name { get; set; } = "";

    /// <summary>See <see cref="ScetAlarm.Subject"/>. Empty is read as <c>"game"</c>.</summary>
    [SitrepUnit(Units.Id)]
    public string Subject { get; set; } = "game";

    public ScetAlarmCondition Condition { get; set; } = new ScetAlarmCondition();
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
[SitrepCommand("alarm.scet.disarm", Delayed = false)]
public class ScetAlarmDisarmArgs
{
    [SitrepUnit(Units.Id)]
    public string Id { get; set; } = "";
}
