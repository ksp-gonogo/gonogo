#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Mirrors KSP's own <c>VesselAutopilot.AutopilotMode</c> enum (confirmed via
/// decompile: <c>StabilityAssist, Prograde, Retrograde, Normal, Antinormal,
/// RadialIn, RadialOut, Target, AntiTarget, Maneuver</c> — no
/// <c>Navigation</c> member exists on this KSP version). <see cref="Unknown"/>
/// is the graceful fallback for a raw value this contract doesn't recognize
/// yet, same convention as <see cref="VesselType"/>/<see cref="TransitionType"/>.
/// </summary>
#if NETSTANDARD2_0
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
/// could carry state but never a NAME — and a name is the whole point:
/// stock KSP's ten customs are anonymous, but Action Groups Extended (AGX)
/// gives the player up to 250 groups they name themselves ("Solar Panels",
/// "Science Bay"). A positional array cannot express that, so the client was
/// forced to hardcode "AG1".."AG10" labels.
///
/// <para>Scope: this list carries the CUSTOM (extensible) groups only. The
/// stock singletons — SAS/RCS/Gear/Brakes/Lights/Abort — keep their own
/// dedicated <see cref="VesselControl"/> fields and their own dedicated
/// commands (<c>vessel.control.setGear</c> etc.), because they are fixed
/// stock concepts that no mod extends: AGX adds custom groups, it does not
/// add a second SAS. Folding them into this list would trade a typed field
/// for a string match and gain nothing.</para>
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class ActionGroupState
{
    /// <summary>
    /// 1-based group number — the same number
    /// <c>vessel.control.setActionGroup</c> takes. Stock KSP: 1..10
    /// (<c>KSPActionGroup.Custom01..Custom10</c>). An AGX backend may report
    /// indices up to 250. Consumers must NOT assume 10, nor assume the list
    /// is dense or sorted.
    /// </summary>
    public int Index { get; set; }

    /// <summary>
    /// Human display name. Stock KSP has no per-group naming, so the stock
    /// backend reports <c>"AG1".."AG10"</c> — exactly what the UI already
    /// showed, now sourced from the mod rather than hardcoded client-side.
    /// An AGX backend reports the player's own names instead.
    /// </summary>
    public string Name { get; set; } = "";

    /// <summary>Whether the group is currently engaged.</summary>
    public bool State { get; set; }
}

/// <summary>
/// The <c>vessel.control</c> channel payload — the READ half of what
/// Telemachus split across <c>f.</c> (toggle/action) and <c>v.</c>
/// (value-read) prefixes for the same concept (N-1's read half; the WRITE
/// half is a future typed-command task). Every field is individually
/// nullable — R1(a): a null field is a normal, meaningful "this input isn't
/// available this tick" (e.g. no <c>ctrlState</c>/no action-group data),
/// never a sentinel default — while the record ITSELF is present whenever a
/// vessel is (KspHost's <c>BuildControl</c> always returns a group, never a
/// null one).
///
/// <para><b>V-3 documented, not silently "fixed":</b> <see cref="Throttle"/>
/// is 0..1 NOMINALLY, but KSP's own <c>FlightInputHandler.state.mainThrottle</c>
/// isn't clamped upstream — a kOS/mod-driven throttle can genuinely read
/// &gt; 1 (the "200% throttle" phantom). Silently clamping it here would be a
/// NEW wart (lying about upstream game truth); the range is documented,
/// reader beware.</para>
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
[SitrepTopic("vessel.control")]
public class VesselControl
{
    public bool? Sas { get; set; }

    public SasMode? SasMode { get; set; }

    public bool? Rcs { get; set; }

    public bool? Gear { get; set; }

    public bool? Brakes { get; set; }

    public bool? Lights { get; set; }

    public bool? Abort { get; set; }

    /// <summary>
    /// Precision-control (fine-control / caps-lock) mode. Mirrors KSP's
    /// <c>FlightInputHandler.fetch.precisionMode</c>. Null when there's no
    /// active flight scene (<c>FlightInputHandler.fetch</c> is null), never a
    /// sentinel default (R1(a)).
    /// </summary>
    public bool? PrecisionControl { get; set; }

    /// <summary>0..1 nominal range — NOT guaranteed clamped upstream (V-3), see the class doc comment.</summary>
    public double? Throttle { get; set; }

    /// <summary>
    /// Every CUSTOM action group the elected action-groups backend knows,
    /// each NAMED and carrying its own index (see
    /// <see cref="ActionGroupState"/>). Stock KSP yields ten entries
    /// (<c>AG1..AG10</c>); an AGX backend may yield up to 250 with the
    /// player's own names. Null when action-group data wasn't available this
    /// tick — never a partial list. Order is by <see cref="ActionGroupState.Index"/>
    /// ascending, but read <see cref="ActionGroupState.Index"/> rather than
    /// relying on array position: position carried the identity in the old
    /// <c>bool[]</c> shape and no longer does.
    /// </summary>
    public ActionGroupState[]? ActionGroups { get; set; }

    public PayloadMeta Meta { get; set; } = new();
}
