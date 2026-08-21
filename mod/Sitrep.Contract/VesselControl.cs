#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Mirrors KSP's own <c>VesselAutopilot.AutopilotMode</c> enum (confirmed via
/// decompile: <c>StabilityAssist, Prograde, Retrograde, Normal, Antinormal,
/// RadialIn, RadialOut, Target, AntiTarget, Maneuver</c>: no
/// <c>Navigation</c> member exists on this KSP version). <see cref="Unknown"/>
/// is the graceful fallback for a raw value this contract doesn't recognize
/// yet, same convention as <see cref="VesselType"/>/<see cref="TransitionType"/>.
/// </summary>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum SasMode
{
    StabilityAssist,
    Prograde,
    Retrograde,
    Normal,
    Antinormal,
    RadialIn,
    RadialOut,
    Target,
    AntiTarget,
    Maneuver,
    Unknown,
}

/// <summary>
/// One custom action group's IDENTITY plus its live state. Replaces the old
/// positional <c>bool[]</c> (<c>[ag1..ag10]</c> by array position), which
/// could carry state but never a NAME, and a name is the whole point:
/// stock KSP's ten customs are anonymous, but Action Groups Extended (AGX)
/// gives the player up to 250 groups they name themselves ("Solar Panels",
/// "Science Bay"). A positional array cannot express that, so the client was
/// forced to hardcode "AG1".."AG10" labels.
///
/// <para>Scope: this list carries the CUSTOM (extensible) groups only. The
/// stock singletons (SAS/RCS/Gear/Brakes/Lights/Abort) keep their own
/// dedicated <see cref="VesselControl"/> fields and their own dedicated
/// commands (<c>vessel.control.setGear</c> etc.), because they are fixed
/// stock concepts that no mod extends: AGX adds custom groups, it does not
/// add a second SAS. Folding them into this list would trade a typed field
/// for a string match and gain nothing.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class ActionGroupState
{
    /// <summary>
    /// 1-based group number: the same number
    /// <c>vessel.control.setActionGroup</c> takes. Stock KSP: 1..10
    /// (<c>KSPActionGroup.Custom01..Custom10</c>). An AGX backend may report
    /// indices up to 250. Consumers must NOT assume 10, nor assume the list
    /// is dense or sorted.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public int Index { get; set; }

    /// <summary>
    /// Human display name. Stock KSP has no per-group naming, so the stock
    /// backend reports <c>"AG1".."AG10"</c>: exactly what the UI already
    /// showed, now sourced from the mod rather than hardcoded client-side.
    /// An AGX backend reports the player's own names instead.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string Name { get; set; } = "";

    /// <summary>Whether the group is currently engaged.</summary>
    [SitrepUnit(Units.Flag)]
    public bool State { get; set; }
}

/// <summary>
/// The <c>vessel.control</c> channel payload: the READ half of what
/// Telemachus split across <c>f.</c> (toggle/action) and <c>v.</c>
/// (value-read) prefixes for the same concept (N-1's read half; the WRITE
/// half is a future typed-command task). Every field is individually
/// nullable, R1(a): a null field is a normal, meaningful "this input isn't
/// available this tick" (e.g. no <c>ctrlState</c>/no action-group data),
/// never a sentinel default: while the record ITSELF is present whenever a
/// vessel is (KspHost's <c>BuildControl</c> always returns a group, never a
/// null one).
///
/// <para><b>V-3 documented, not silently "fixed":</b> <see cref="Throttle"/>
/// is 0..1 NOMINALLY, but KSP's own <c>FlightInputHandler.state.mainThrottle</c>
/// isn't clamped upstream: a kOS/mod-driven throttle can genuinely read
/// &gt; 1 (the "200% throttle" phantom). Silently clamping it here would be a
/// NEW wart (lying about upstream game truth); the range is documented,
/// reader beware.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("vessel.control")]
public class VesselControl
{
    /// <summary>SAS master switch. Its control channel pairs it with <c>setSas</c> so a client can read the confirmed state and dispatch a change through ONE handle.</summary>
    [SitrepControlChannel("vessel.control.sas", "vessel.control.setSas", typeof(SetEnabledArgs), nameof(SetEnabledArgs.Enabled))]
    [SitrepUnit(Units.Flag)]
    public bool? Sas { get; set; }

    [SitrepControlChannel("vessel.control.sasMode", "vessel.control.setSasMode", typeof(SetSasModeArgs), nameof(SetSasModeArgs.Mode))]
    [SitrepUnit(Units.Enumeration)]
    public SasMode? SasMode { get; set; }

    [SitrepControlChannel("vessel.control.rcs", "vessel.control.setRcs", typeof(SetEnabledArgs), nameof(SetEnabledArgs.Enabled))]
    [SitrepUnit(Units.Flag)]
    public bool? Rcs { get; set; }

    [SitrepControlChannel("vessel.control.gear", "vessel.control.setGear", typeof(SetEnabledArgs), nameof(SetEnabledArgs.Enabled))]
    [SitrepUnit(Units.Flag)]
    public bool? Gear { get; set; }

    [SitrepControlChannel("vessel.control.brakes", "vessel.control.setBrakes", typeof(SetEnabledArgs), nameof(SetEnabledArgs.Enabled))]
    [SitrepUnit(Units.Flag)]
    public bool? Brakes { get; set; }

    [SitrepControlChannel("vessel.control.lights", "vessel.control.setLights", typeof(SetEnabledArgs), nameof(SetEnabledArgs.Enabled))]
    [SitrepUnit(Units.Flag)]
    public bool? Lights { get; set; }

    [SitrepControlChannel("vessel.control.abort", "vessel.control.setAbort", typeof(SetEnabledArgs), nameof(SetEnabledArgs.Enabled))]
    [SitrepUnit(Units.Flag)]
    public bool? Abort { get; set; }

    /// <summary>
    /// Precision-control (fine-control / caps-lock) mode. Mirrors KSP's
    /// <c>FlightInputHandler.fetch.precisionMode</c>. Null when there's no
    /// active flight scene (<c>FlightInputHandler.fetch</c> is null), never a
    /// sentinel default (R1(a)).
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? PrecisionControl { get; set; }

    /// <summary>0..1 nominal range: NOT guaranteed clamped upstream (V-3), see the class doc comment.</summary>
    [SitrepControlChannel("vessel.control.throttle", "vessel.control.setThrottle", typeof(SetThrottleArgs), nameof(SetThrottleArgs.Value))]
    [SitrepUnit(Units.Ratio)]
    public double? Throttle { get; set; }

    // Commanded fly-by-wire axis inputs (the ECHO half of the setAxes stream
    // channels below), each -1..1 mirroring KSP's FlightInputHandler ctrlState.
    // These exist so each axis has a read-anchor for its
    // [SitrepControlChannel] and a confirmed-readback track in the client's
    // ControlDelayStream: the operator sees a delayed axis command ARRIVE
    // (the echo lags the commanded track by the round trip), exactly as the
    // throttle channel does. Null when no active flight scene (no ctrlState),
    // never a sentinel default (R1(a)). Populated by KspHost.BuildControl.
    // LIVE-TEST-REQUIRED: verify these read the applied axis, not a stale zero.

    /// <summary>Commanded pitch axis input, -1..1 (FlightInputHandler ctrlState.pitch).</summary>
    [SitrepControlChannel("vessel.control.pitch", "vessel.control.setAxes", typeof(SetControlAxesArgs), nameof(SetControlAxesArgs.Pitch))]
    [SitrepUnit(Units.Dimensionless)]
    public double? Pitch { get; set; }

    /// <summary>Commanded yaw axis input, -1..1 (FlightInputHandler ctrlState.yaw).</summary>
    [SitrepControlChannel("vessel.control.yaw", "vessel.control.setAxes", typeof(SetControlAxesArgs), nameof(SetControlAxesArgs.Yaw))]
    [SitrepUnit(Units.Dimensionless)]
    public double? Yaw { get; set; }

    /// <summary>Commanded roll axis input, -1..1 (FlightInputHandler ctrlState.roll).</summary>
    [SitrepControlChannel("vessel.control.roll", "vessel.control.setAxes", typeof(SetControlAxesArgs), nameof(SetControlAxesArgs.Roll))]
    [SitrepUnit(Units.Dimensionless)]
    public double? Roll { get; set; }

    /// <summary>Commanded translation X (RCS right/left) input, -1..1 (ctrlState.X).</summary>
    [SitrepControlChannel("vessel.control.translationX", "vessel.control.setAxes", typeof(SetControlAxesArgs), nameof(SetControlAxesArgs.X))]
    [SitrepUnit(Units.Dimensionless)]
    public double? TranslationX { get; set; }

    /// <summary>Commanded translation Y (RCS up/down) input, -1..1 (ctrlState.Y).</summary>
    [SitrepControlChannel("vessel.control.translationY", "vessel.control.setAxes", typeof(SetControlAxesArgs), nameof(SetControlAxesArgs.Y))]
    [SitrepUnit(Units.Dimensionless)]
    public double? TranslationY { get; set; }

    /// <summary>Commanded translation Z (RCS fwd/back) input, -1..1 (ctrlState.Z).</summary>
    [SitrepControlChannel("vessel.control.translationZ", "vessel.control.setAxes", typeof(SetControlAxesArgs), nameof(SetControlAxesArgs.Z))]
    [SitrepUnit(Units.Dimensionless)]
    public double? TranslationZ { get; set; }

    /// <summary>
    /// Every CUSTOM action group the elected action-groups backend knows,
    /// each NAMED and carrying its own index (see
    /// <see cref="ActionGroupState"/>). Stock KSP yields ten entries
    /// (<c>AG1..AG10</c>); an AGX backend may yield up to 250 with the
    /// player's own names. Null when action-group data wasn't available this
    /// tick: never a partial list. Order is by <see cref="ActionGroupState.Index"/>
    /// ascending, but read <see cref="ActionGroupState.Index"/> rather than
    /// relying on array position: position carried the identity in the old
    /// <c>bool[]</c> shape and no longer does.
    /// </summary>
    public ActionGroupState[]? ActionGroups { get; set; }

    public PayloadMeta Meta { get; set; } = new();
}
