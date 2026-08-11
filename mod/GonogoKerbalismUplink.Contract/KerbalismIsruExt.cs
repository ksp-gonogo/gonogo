using Sitrep.Contract;
#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace GonogoKerbalismUplink;

// ─────────────────────────────────────────────────────────────────────────────
// The Kerbalism namespaces of the two elected isru.* payloads' provider extension
// bags.
//
// isru.* is a Kernel-ELECTED capability (Sitrep.Contract/Isru.cs): one shared
// payload shape per channel, filled by whichever backend won. Kerbalism WINS that
// election when installed, because it does not add to stock's ISRU model, it
// replaces it: its own MM patches delete ModuleResourceHarvester and
// ModuleResourceConverter outright, so on a Kerbalism install the stock reader
// walks a vessel and finds nothing at all.
//
// Unlike science, most of what Kerbalism's ISRU knows DOES have a stock
// counterpart, which is why the core shape carries it and these two types are
// small. What is left over is genuinely Kerbalism-only:
//
//   • the blocking-reason string. Stock has no equivalent: a stock drill that
//     cannot extract just silently switches itself off. This is the single
//     strongest thing the Kerbalism provider adds, because "why is Ore production
//     zero" otherwise has no answer on the wire at all
//   • the asteroid/comet depletion state, where abundance is a property of the
//     rock rather than of the environment
//   • the ProcessController's own throttle state, which has no stock analogue
//     because a stock converter IS its recipe rather than a capacity that
//     throttles a decoupled one
//
// TYPING-ONLY, exactly like KerbalismPayloads.cs and KerbalismScienceExt.cs: this
// adds no wire bytes. The wire is written by JsonWriter walking the untyped value
// tree KerbalismIsruBackend builds, and the two are kept honest by
// IsruExtensionWireTests (the real backend through the real EnvelopeCodec) plus
// the golden fixture the client's own test reads back.
//
// ── No unit token is declared here, deliberately ────────────────────────────
// Every quantity below is dimensioned in a unit Sitrep.Contract.Units already has
// (units/s, t, count). That is not an accident of scope: Kerbalism measures ISRU
// in the same resource units the game does, unlike its science, which is in
// megabytes where stock is in mits. So this bag needs no registerUnit call at all,
// and the client half is purely the shape registration.
// ─────────────────────────────────────────────────────────────────────────────

/// <summary>
/// Kerbalism's <c>extensions["kerbalism"]</c> sub-tree of one <c>isru.drills</c>
/// entry: the diagnostic and the depletion state the shared shape has no field
/// for.
///
/// <para>Read client-side through this Uplink's own
/// <c>readKerbalismIsruDrillExt</c>, never by reaching into the bag at a call
/// site.</para>
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class KerbalismIsruDrillExtension
{
    /// <summary>
    /// The live blocking-reason string ("no atmosphere", "not deployed", ...).
    /// Empty when the drill is fine, which is the normal case, so a renderer shows
    /// this only when it is non-empty.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? Issue { get; set; }

    /// <summary>
    /// The harvest-type variant: 0-3 are the stock-equivalent situations, 4 is
    /// asteroid/comet. Free text rather than a closed enum, mirroring the posture
    /// the shared <c>Resource</c> field already takes: the numbering is a Kerbalism
    /// implementation detail and a closed enum here would break on any renumber.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? HarvestType { get; set; }

    /// <summary>
    /// EC drawn per second, independent of abundance. A drill that is deployed and
    /// running still costs this even where there is nothing to extract, which is
    /// exactly the case an operator wants to catch.
    /// </summary>
    [SitrepUnit(Units.ResourceUnitsPerSecond)]
    public double? EcRate { get; set; }

    /// <summary>
    /// Asteroid/comet mining only: remaining rock mass. Null for surface, ocean and
    /// atmospheric harvesters, where abundance is a property of the environment
    /// rather than of a finite source.
    /// </summary>
    [SitrepUnit(Units.Tonnes)]
    public double? SourceMassRemaining { get; set; }

    /// <summary>
    /// Asteroid/comet mining only: the depletion threshold below which the source
    /// is exhausted. Paired with <see cref="SourceMassRemaining"/>, this is what
    /// lets a reader show how much of the rock is actually still minable rather
    /// than how much of it is left.
    /// </summary>
    [SitrepUnit(Units.Tonnes)]
    public double? SourceMassThreshold { get; set; }
}

/// <summary>
/// Kerbalism's <c>extensions["kerbalism"]</c> sub-tree of one
/// <c>isru.converters</c> entry: the <c>ProcessController</c>'s own throttle state,
/// which is what a Kerbalism converter actually is.
///
/// <para>Structurally the same field set <c>KerbalismProcessEntry</c> already
/// models for life-support processes, and deliberately so: Kerbalism does not
/// distinguish an ISRU process from a life-support one internally, a Process is a
/// Process regardless of what it converts. Inventing a parallel shape here would
/// have asserted a distinction the engine does not draw.</para>
///
/// <para><b>There is no issue field here, and there must not be one.</b> Unlike a
/// Harvester, a ProcessController has no discrete blocking-reason: a starved recipe
/// simply clamps its rate to zero. A reader derives that from the shared shape
/// (<c>running</c> true alongside zero rates) rather than from a string, because a
/// string here would be gonogo fabricating a diagnostic Kerbalism never
/// reports.</para>
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class KerbalismIsruConverterExtension
{
    /// <summary>
    /// The pseudo-resource this ProcessController throttles on
    /// ("_MoltenRegolithElectrolysis", ...). The join key onto Kerbalism's own
    /// Process definition, not a real resource, which is why it is not the shared
    /// shape's resource field wearing a different name.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? ProcessToken { get; set; }

    /// <summary>
    /// The process's own display title, distinct from the part title (e.g. "Molten
    /// Regolith Electrolysis" running on an ISRU Chemical Plant part). One part can
    /// be reconfigured to run a different process, so the two genuinely differ.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? Title { get; set; }

    /// <summary>
    /// How many units of the process this part runs at once. Every rate on the
    /// shared shape is already scaled by this: it is the multiplier behind those
    /// numbers, surfaced so a reader can tell a half-capacity plant from a
    /// half-starved one.
    /// </summary>
    [SitrepUnit(Units.ResourceUnits)]
    public double? Capacity { get; set; }

    /// <summary>
    /// Distinct from the shared <c>running</c> flag: a part-integrity failure, not
    /// merely toggled off. A broken plant cannot be started until it is repaired.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? Broken { get; set; }

    /// <summary>
    /// Active dump-valve index: which outputs vent overboard rather than being
    /// captured. Live per-part state that changes what the shared shape's outputs
    /// actually MEAN for this instance, which is why it belongs next to them.
    /// </summary>
    [SitrepUnit(Units.Count)]
    public int? ValveIndex { get; set; }
}
