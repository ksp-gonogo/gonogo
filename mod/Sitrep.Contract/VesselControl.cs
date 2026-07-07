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
#if NETSTANDARD2_0
[TsInterface]
#endif
public class VesselControl
{
    public bool? Sas { get; set; }

    public SasMode? SasMode { get; set; }

    public bool? Rcs { get; set; }

    public bool? Gear { get; set; }

    public bool? Brakes { get; set; }

    public bool? Lights { get; set; }

    /// <summary>0..1 nominal range — NOT guaranteed clamped upstream (V-3), see the class doc comment.</summary>
    public double? Throttle { get; set; }

    /// <summary>[ag1..ag10], in that fixed order. Null when action-group data wasn't available this tick (never a partial/short array).</summary>
    public bool[]? ActionGroups { get; set; }

    public PayloadMeta Meta { get; set; } = new();
}
