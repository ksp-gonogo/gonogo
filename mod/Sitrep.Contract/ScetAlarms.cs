#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Which kind of condition a SCET alarm watches for.
///
/// <para>Only <see cref="Time"/> exists today. A SCET vantage is meaningful
/// exactly where the craft's TRUE state and the state the ground has been told
/// differ, which is why there is no member here for a contract parameter:
/// career bookkeeping is known to the command centre without any link, so there
/// is no gap for a vantage to straddle.</para>
/// </summary>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum ScetAlarmConditionKind
{
    /// <summary>An instant on the craft's own clock, as a universal time.</summary>
    Time,
}

/// <summary>
/// Where an armed SCET alarm has got to.
///
/// <para>A latch, not a level: <see cref="Fired"/> is reached once and stays,
/// so a condition that keeps holding cannot stop the warp again on the next
/// tick.</para>
/// <internal>
/// Deliberately two members rather than three. The spec sketched an
/// <c>Unreachable</c> for a craft that was destroyed before its alarm could
/// fire, which a time condition cannot be: a clock has no subject to lose. The
/// member belongs with the threshold arm that gives an alarm a craft to watch,
/// and adding it then is a free, additive contract change.
/// </internal>
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
}

/// <summary>
/// What a SCET alarm watches for, on the craft's own clock.
///
/// <para>A discriminated shape: <see cref="Kind"/> says which of the fields
/// below carry meaning. For <see cref="ScetAlarmConditionKind.Time"/> that is
/// <see cref="Ut"/> and <see cref="LeadSeconds"/>.</para>
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
    /// game's, and a clock has no craft to belong to. The field is not therefore
    /// decoration, it is what stops a condition that DOES name a craft from
    /// silently re-aiming when the player switches vessels.</para>
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
[SitrepCommand("alarm.scet.arm")]
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
[SitrepCommand("alarm.scet.disarm")]
public class ScetAlarmDisarmArgs
{
    [SitrepUnit(Units.Id)]
    public string Id { get; set; } = "";
}
