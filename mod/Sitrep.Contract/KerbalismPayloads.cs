using System.Collections.Generic;
#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

// ─────────────────────────────────────────────────────────────────────────────
// Kerbalism Topic payloads (Domain "kerbalism").
//
// The GonogoKerbalismUplink (mod/GonogoKerbalismUplink/) publishes these by
// reflecting over Kerbalism's KERBALISM.API / Features / DB.Kerbal(name).rules
// and the ProcessController PartModules, the SAME reflection the proven
// mod/GonogoDevTools/GonogoDevKerbalismDump.cs performs (it produced the
// fixtures these shapes are grounded in: local_docs/kerbalism-fixtures/,
// canonical kerbalism-fixture-baseline-crp.json).
//
// TYPING-ONLY, like ScanPayloads.cs: these mirror, field-for-field, the
// Dictionary<string, object?> value trees KerbalismCapture.Build* emit (camelCase
// wire keys via RtConfig.CamelCaseForProperties). They add no wire bytes; the
// wire is written by JsonWriter walking the uplink's live value tree. All members
// are nullable to mirror the permissive-on-absence convention; a live payload
// always carries concrete values.
//
// kerbalism.available is a BARE JSON boolean declared client-side
// (mod/GonogoKerbalismUplink/client/src/topics.ts via registerBarePrimitiveTopic),
// NOT here, same treatment as the other Uplinks' bare `<domain>.available`.
// ─────────────────────────────────────────────────────────────────────────────

/// <summary>
/// Space-weather situation for the active vessel, radiation, magnetic belts,
/// storm state. Mirrors <c>KERBALISM.API</c> vessel reads (<c>Radiation</c>,
/// <c>HabitatRadiation</c>, <c>Magnetosphere</c>/<c>InnerBelt</c>/<c>OuterBelt</c>,
/// <c>StormIncoming</c>/<c>StormInProgress</c>/<c>Blackout</c>, <c>InSunlight</c>)
/// plus the <c>Shielding</c> resource.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
[SitrepTopic("kerbalism.spaceweather")]
public class KerbalismSpaceWeather
{
    /// <summary>
    /// Raw <c>API.Radiation(v)</c>, i.e. <c>VesselData.EnvRadiation</c>. Units
    /// confirmed rad/s from Kerbalism source (UI/Monitor.cs computes rad/h
    /// display values as <c>EnvHabitatRadiation * 3600.0</c>, the same
    /// per-second-to-per-hour factor the client applies here).
    /// </summary>
    [SitrepUnit(Units.RadPerSecond)]
    public double? RadiationRadPerSecond { get; set; }
    [SitrepUnit(Units.RadPerSecond)]
    public double? HabitatRadiationRadPerSecond { get; set; }
    [SitrepUnit(Units.Flag)]
    public bool? Magnetosphere { get; set; }
    [SitrepUnit(Units.Flag)]
    public bool? InnerBelt { get; set; }
    [SitrepUnit(Units.Flag)]
    public bool? OuterBelt { get; set; }
    [SitrepUnit(Units.Flag)]
    public bool? StormIncoming { get; set; }
    [SitrepUnit(Units.Flag)]
    public bool? StormInProgress { get; set; }
    [SitrepUnit(Units.Flag)]
    public bool? Blackout { get; set; }
    [SitrepUnit(Units.Flag)]
    public bool? InSunlight { get; set; }
    /// <summary>Shielding resource amount/capacity (0 in the default profile; present under RO/Habitat).</summary>
    [SitrepUnit(Units.ResourceUnits)]
    public double? ShieldingAmount { get; set; }
    [SitrepUnit(Units.ResourceUnits)]
    public double? ShieldingCapacity { get; set; }
}

/// <summary>One life-support consumable: amount, capacity, signed net rate (units/s, negative = draining).</summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class KerbalismResource
{
    [SitrepUnit(Units.ResourceUnits)]
    public double? Amount { get; set; }
    [SitrepUnit(Units.ResourceUnits)]
    public double? Capacity { get; set; }
    [SitrepUnit(Units.ResourceUnitsPerSecond)]
    public double? Rate { get; set; }
}

/// <summary>Habitat scalars from <c>KERBALISM.API</c> (all 0..1 factors except Volume/Surface).</summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class KerbalismHabitat
{
    [SitrepUnit(Units.Ratio)]
    public double? Pressure { get; set; }
    [SitrepUnit(Units.Ratio)]
    public double? Poisoning { get; set; }
    [SitrepUnit(Units.Ratio)]
    public double? Shielding { get; set; }
    [SitrepUnit(Units.Ratio)]
    public double? LivingSpace { get; set; }
    [SitrepUnit(Units.Ratio)]
    public double? Comfort { get; set; }
    [SitrepUnit(Units.CubicMetres)]
    public double? Volume { get; set; }
    [SitrepUnit(Units.SquareMetres)]
    public double? Surface { get; set; }
}

/// <summary>One ProcessController process (scrubber / recycler / fuel cell).</summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class KerbalismProcessEntry
{
    /// <summary>
    /// The PSEUDO-RESOURCE this controller gates on ("_Scrubber",
    /// "_WaterRecycler", ...), not a real resource. It is the JOIN KEY onto
    /// <see cref="KerbalismProcessDef.Modifiers"/>: the profile Process whose
    /// modifier list contains this token is the one this controller runs.
    /// Confirmed against a captured fixture and the stock profile config.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? Resource { get; set; }
    [SitrepUnit(Units.Text)]
    public string? Title { get; set; }
    /// <summary>
    /// Process capacity of the hosting part. Kerbalism scales EVERY rate in the
    /// matched <see cref="KerbalismProcessDef"/> by this, so
    /// <c>profileRate * capacity</c> is this instance's contribution and the
    /// unit the per-source ledger is built from.
    /// </summary>
    [SitrepUnit(Units.ResourceUnits)]
    public double? Capacity { get; set; }
    [SitrepUnit(Units.Flag)]
    public bool? Running { get; set; }
    [SitrepUnit(Units.Flag)]
    public bool? Broken { get; set; }
    /// <summary>
    /// Host part, as KSP's <c>Part.flightID</c>: matches <c>ShipMapPart.flightId</c>
    /// exactly, so a ledger row joins straight onto a part in the ship diagram.
    /// flightID and NOT the part name: the dev dump records its <c>_part</c> as
    /// a part name ("mk1pod.v2") for readability, which would collapse a vessel
    /// carrying two identical pods into one row. Without this field the ledger
    /// can say WHAT is consuming but never WHERE.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public double? FlightId { get; set; }
    /// <summary>
    /// Active dump valve, indexing <see cref="KerbalismProcessDef.DumpValves"/>
    /// (<c>ProcessController.valve_i</c>). Which outputs are vented rather than
    /// stored is live per-part state and changes what the ledger means, the
    /// profile only lists the possible combinations.
    /// </summary>
    [SitrepUnit(Units.Count)]
    public int? ValveIndex { get; set; }
}

// ─────────────────────────────────────────────────────────────────────────────
// The loaded profile (Topic "kerbalism.profile").
//
// Kerbalism's own static configuration, normalised onto the wire so the app can
// derive the resource graph, the per-source rate ledger and the root-cause walk
// WITHOUT gonogo ever naming a resource. Kerbalism ships static config; we read
// it. We never ship a list of resources.
//
// The mod parses, the app derives: these are DEFINITIONS only. No adjacency, no
// cycle detection, no derived rates beyond the one noted on
// KerbalismRuleDef.RatePerSecond. That keeps the wire stable while the app's
// analysis evolves.
// ─────────────────────────────────────────────────────────────────────────────

/// <summary>
/// Static facts about one resource the loaded profile touches, from KSP's own
/// resource definition plus the profile's Supply declarations.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class KerbalismResourceDef
{
    /// <summary>
    /// KSP <c>ResourceFlowMode</c> as its enum NAME (<c>ALL_VESSEL</c>,
    /// <c>ALL_VESSEL_BALANCE</c>, <c>STAGE_PRIORITY_FLOW</c>,
    /// <c>STACK_PRIORITY_SEARCH</c>, <c>NO_FLOW</c>). An open string rather than a
    /// closed enum: an unrecognised mode must degrade, not break the payload.
    ///
    /// <para>Why it matters: for a POOLED mode the per-part split is bookkeeping
    /// and the vessel drains one pool, so a per-tank meter is at best decorative
    /// and at worst misleading. A consumer cannot know that without this field,
    /// which is why per-part resource meters depend on it.</para>
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? FlowMode { get; set; }
    /// <summary>Localised display name from the KSP resource definition, when it differs from the key.</summary>
    [SitrepUnit(Units.Text)]
    public string? DisplayName { get; set; }
    [SitrepUnit(Units.KilogramsPerCubicMetre)]
    public double? Density { get; set; }
    /// <summary>
    /// True when the profile declares a <c>Supply</c> for this resource, i.e. it is
    /// life support rather than a propellant some process merely touches.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? IsSupply { get; set; }
    /// <summary>Kerbalism's own warning level (<c>Supply.low_threshold</c>). Null when not a Supply.</summary>
    [SitrepUnit(Units.Ratio)]
    public double? LowThreshold { get; set; }
}

/// <summary>
/// One <c>Profile.rules[]</c> entry: a PER-KERBAL consumption, not a vessel
/// process. Crew rules scale with head count; processes scale with part capacity.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class KerbalismRuleDef
{
    [SitrepUnit(Units.Text)]
    public string? Name { get; set; }
    /// <summary>Consumed resource. Empty for rules modelling a pure accumulator (stress, radiation).</summary>
    [SitrepUnit(Units.Text)]
    public string? Input { get; set; }
    /// <summary>Produced resource. Empty when the rule produces nothing; rule outputs are always dumped by Kerbalism.</summary>
    [SitrepUnit(Units.Text)]
    public string? Output { get; set; }
    /// <summary>
    /// CANONICAL. Consumption per kerbal per SECOND, already divided by
    /// <see cref="Interval"/>. Use this one.
    ///
    /// <para>Carried pre-divided, rather than leaving each consumer to do it,
    /// because forgetting to is a silent error that reads as entirely plausible:
    /// <c>drinking</c> has <c>interval = 5400</c> and <c>eating</c> has
    /// <c>interval = 10800</c>, so reading their raw <c>rate</c> as per-second
    /// overstates them by 5,400x and 10,800x. <c>breathing</c> has no interval
    /// and genuinely IS per second, which is why the mistake survives the one
    /// resource anybody sanity-checks first.</para>
    /// </summary>
    [SitrepUnit(Units.ResourceUnitsPerSecond)]
    public double? RatePerSecond { get; set; }
    /// <summary>Raw <c>Profile.rules[].rate</c>, for fidelity. NOT a per-second figure unless <see cref="Interval"/> is 0.</summary>
    [SitrepUnit(Units.ResourceUnits)]
    public double? Rate { get; set; }
    /// <summary>
    /// <c>Profile.rules[].interval</c>, seconds: the rule fires once per interval.
    /// 0 means continuous, in which case <see cref="RatePerSecond"/> equals <see cref="Rate"/>.
    /// </summary>
    [SitrepUnit(Units.Seconds)]
    public double? Interval { get; set; }
    [SitrepUnit(Units.ResourceUnitsPerSecond)]
    public double? Degeneration { get; set; }
    [SitrepUnit(Units.ResourceUnits)]
    public double? FatalThreshold { get; set; }
    /// <summary>When true, reaching fatal redirects to a recoverable breakdown event instead of killing the kerbal.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? Breakdown { get; set; }
    /// <summary>Raw modifier keyword tokens, deliberately unparsed. See <see cref="KerbalismProcessDef.Modifiers"/>.</summary>
    [SitrepUnit(Units.Text)]
    public List<string>? Modifiers { get; set; }
}

/// <summary>
/// One <c>Profile.processes[]</c> entry: a vessel converter. Every rate below is
/// PER UNIT OF PROCESS CAPACITY; multiply by a hosting
/// <see cref="KerbalismProcessEntry.Capacity"/> for that instance's real contribution.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class KerbalismProcessDef
{
    [SitrepUnit(Units.Text)]
    public string? Name { get; set; }
    /// <summary>Resource name -> rate per unit of process capacity, per second.</summary>
    public Dictionary<string, double>? Inputs { get; set; }
    /// <summary>Resource name -> rate per unit of process capacity, per second.</summary>
    public Dictionary<string, double>? Outputs { get; set; }
    /// <summary>
    /// The Process's own modifier tokens. REQUIRED: this list contains the
    /// pseudo-resource (e.g. "_Scrubber") that joins to
    /// <see cref="KerbalismProcessEntry.Resource"/>, which is how a part's
    /// controller is matched to the recipe it runs.
    ///
    /// <para>Tokens are shipped RAW and unparsed on purpose. Kerbalism's
    /// <c>Modifiers.cs</c> recognises 14 keywords and its default case treats any
    /// UNKNOWN token as a resource-amount lookup (with an <c>inv:</c> prefix
    /// inverting it), so there is no closed set to model. Parsing them here would
    /// mean freezing a keyword list we would then have to chase, or shipping a
    /// half-interpretation the app cannot reason about. Raw tokens let a consumer
    /// act on what it recognises and render the rest as honest provenance.</para>
    /// </summary>
    [SitrepUnit(Units.Text)]
    public List<string>? Modifiers { get; set; }
    /// <summary>
    /// <c>dump_valve</c> options in the profile's own order, each an
    /// <c>&amp;</c>-joined combination of output resources.
    /// <see cref="KerbalismProcessEntry.ValveIndex"/> indexes into this list.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public List<string>? DumpValves { get; set; }
}

/// <summary>
/// The loaded Kerbalism profile's own definitions. Static for the life of the
/// KSP session (swapping profile is a restart), so this Topic is declared
/// low-cadence and built once.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
[SitrepTopic("kerbalism.profile")]
public class KerbalismProfile
{
    /// <summary>Loaded profile name ("Default", "RealismOverhaul", ...). Display and fixture keying only, never a behavioural switch.</summary>
    [SitrepUnit(Units.Text)]
    public string? Name { get; set; }
    /// <summary>
    /// Every resource this profile touches: the union of all rule and process
    /// inputs/outputs plus every declared Supply, keyed by KSP resource name.
    ///
    /// <para>THE authoritative list. gonogo must never carry one of its own: the
    /// same enumeration drives which names the life-support capture asks
    /// Kerbalism for a rate about, so the two can never drift.</para>
    /// </summary>
    public Dictionary<string, KerbalismResourceDef>? Resources { get; set; }
    public List<KerbalismRuleDef>? Rules { get; set; }
    public List<KerbalismProcessDef>? Processes { get; set; }
}

/// <summary>
/// One active Greenhouse part's growing state, field-for-field against
/// Kerbalism's own <c>Greenhouse.Data</c> class (src/Kerbalism/Modules/Greenhouse.cs)
/// plus the part's own (non-persistent) config constants. <c>Greenhouse.Data</c>
/// itself carries exactly three fields, <c>Natural</c>, <c>Artificial</c>, <c>Issue</c>,
/// there is no growth fraction or harvest countdown anywhere in the module; Food
/// is produced continuously via a ResourceRecipe, not a discrete harvest event.
/// <c>Natural</c>/<c>Artificial</c> are NOT meaningfully summed: the lighting gate is
/// <c>natural + artificial &gt;= light_tolerance</c>, so the lamp only ever needs to cover
/// the shortfall, not double the total, present both, never a combined figure.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class KerbalismGreenhouseEntry
{
    /// <summary>The resource this greenhouse produces (stock: "Food").</summary>
    [SitrepUnit(Units.Text)]
    public string? CropResource { get; set; }
    /// <summary>Derived continuous production rate, units/s (crop_size * crop_rate when active and lit; 0 when blocked).</summary>
    [SitrepUnit(Units.ResourceUnitsPerSecond)]
    public double? FoodRatePerSec { get; set; }
    /// <summary>Natural light flux reaching the greenhouse, W/m^2 (<c>Greenhouse.Data.natural</c>).</summary>
    [SitrepUnit(Units.WattsPerSquareMetre)]
    public double? Natural { get; set; }
    /// <summary>Supplemental lamp light flux, W/m^2 (<c>Greenhouse.Data.artificial</c>).</summary>
    [SitrepUnit(Units.WattsPerSquareMetre)]
    public double? Artificial { get; set; }
    /// <summary>Persisted on/off KSPField, the player's own toggle, independent of whether it is currently producing.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? Active { get; set; }
    /// <summary>Blocking reason string (<c>Greenhouse.Data.issue</c>), e.g. the localized "insufficient lighting". Empty when growing normally.</summary>
    [SitrepUnit(Units.Text)]
    public string? Issue { get; set; }
    /// <summary>Part config: max lamp EC draw, units/s (<c>ec_rate</c>).</summary>
    [SitrepUnit(Units.ResourceUnitsPerSecond)]
    public double? EcRateMaxPerSec { get; set; }
    /// <summary>Derived actual lamp EC draw this tick, units/s (0 when lamps are off or fully unlit by the sun).</summary>
    [SitrepUnit(Units.ResourceUnitsPerSecond)]
    public double? LampEcDrawPerSec { get; set; }
    /// <summary>Part config: total light flux needed to grow, W/m^2 (<c>light_tolerance</c>).</summary>
    [SitrepUnit(Units.WattsPerSquareMetre)]
    public double? LightToleranceWm2 { get; set; }
    /// <summary>Part config: minimum habitat pressure fraction required (<c>pressure_tolerance</c>).</summary>
    [SitrepUnit(Units.Ratio)]
    public double? PressureTolerance { get; set; }
    /// <summary>Part config: max radiation tolerated, rad/s (<c>radiation_tolerance</c>).</summary>
    [SitrepUnit(Units.RadPerSecond)]
    public double? RadiationToleranceRadPerSec { get; set; }
}

/// <summary>Vessel life-support ledger: consumables, habitat, and the process list.</summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
[SitrepTopic("kerbalism.lifesupport")]
public class KerbalismLifeSupport
{
    /// <summary>
    /// Signed net rate per resource, units/s, keyed by KSP resource name
    /// (Kerbalism's <c>ResourceAverageRate</c>). Negative = draining.
    ///
    /// <para><b>Amounts and capacities are deliberately NOT here.</b>
    /// <c>vessel.resources</c> already carries them for every resource on the
    /// vessel, and <c>ShipMapPart.resources</c> carries them per part. The rate
    /// is the one number the generic path cannot derive, so it is the only one
    /// this channel adds.</para>
    ///
    /// <para><b>Three-way absence</b>, identical to <c>vessel.resources</c>'s
    /// convention: a key ABSENT means Kerbalism reports no rate for that
    /// resource; a key present with 0 is a real, measured zero (in balance); the
    /// whole channel absent means no vessel, or Kerbalism not installed. Every
    /// emission is the FULL map, never a delta, so a key disappearing is itself
    /// a real statement.</para>
    ///
    /// <para>Which resources appear is enumerated from the loaded profile
    /// (<see cref="KerbalismProfile.Resources"/>), never from a list in gonogo.
    /// This map replaced four fixed properties (Food/Water/Oxygen/ElectricCharge)
    /// against a default profile that runs on twelve.</para>
    ///
    /// <para><b>The unit is units/s and is NOT carried in the type.</b> The
    /// codegen refuses <c>[SitrepUnit]</c> on a dictionary ("has no magnitude to
    /// carry"), so unlike every scalar on the wire this map's values arrive as
    /// bare numbers and a consumer must wrap them itself. Teaching the generator
    /// about unit-carrying dictionary VALUES would fix it for every name-keyed
    /// channel at once and is worth doing separately; do not paper over it here
    /// with a non-quantity token, which would state something false.</para>
    /// </summary>
    public Dictionary<string, double>? Rates { get; set; }
    public KerbalismHabitat? Habitat { get; set; }
    public List<KerbalismProcessEntry>? Processes { get; set; }
    /// <summary>
    /// Active Greenhouse parts on the vessel, if any (most vessels carry none,
    /// an empty/absent list is the normal case, not an error). NOT YET POPULATED
    /// by <c>GonogoKerbalismUplink</c>'s capture pipeline as of this field's
    /// addition, reflecting Kerbalism's <c>Greenhouses(Vessel)</c> API into the
    /// wire capture is separate mod-side work. This field defines the honest
    /// forward-looking wire shape so the widget-side augment can be built and
    /// fixture-tested against it now.
    /// </summary>
    public List<KerbalismGreenhouseEntry>? Greenhouses { get; set; }
}

/// <summary>
/// One survival rule for a kerbal: the current accumulator value (from
/// <c>KerbalData.rules</c>) plus the per-rule config constants (from
/// <c>Profile.rules[]</c>) the two-stage death-clock needs.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class KerbalismCrewRule
{
    [SitrepUnit(Units.Text)]
    public string? Name { get; set; }
    /// <summary>Current accumulator value ("problem") from KerbalData.rules.</summary>
    [SitrepUnit(Units.ResourceUnits)]
    public double? Value { get; set; }
    /// <summary>
    /// Per-rule degeneration rate (units/s) from Profile.rules[].degeneration.
    /// Stage-2 death-clock input. Confirmed against Kerbalism source: `Rule.degeneration`
    /// is a public double field (Profile/Rule.cs); values are set per-rule in
    /// GameData/KerbalismConfig/Profiles/Default.cfg.
    /// </summary>
    [SitrepUnit(Units.ResourceUnitsPerSecond)]
    public double? DegenPerSec { get; set; }
    /// <summary>
    /// Fatal accumulator threshold from Profile.rules[].fatal_threshold. Confirmed
    /// against Kerbalism source (Profile/Rule.cs ctor defaults this to 1.0; the
    /// default profile overrides it only for the radiation rule, to 50.0,
    /// GameData/KerbalismConfig/Profiles/Default.cfg's radiation Rule block).
    /// </summary>
    [SitrepUnit(Units.ResourceUnits)]
    public double? FatalThreshold { get; set; }
}

/// <summary>Per-kerbal survival state (dose is the rule named "radiation").</summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
[SitrepTopic("kerbalism.crew", isArray: true)]
public class KerbalismCrewEntry
{
    [SitrepUnit(Units.Text)]
    public string? Name { get; set; }
    [SitrepUnit(Units.Text)]
    public string? Trait { get; set; }
    public List<KerbalismCrewRule>? Rules { get; set; }
    /// <summary>Optional mod-computed soonest-fatal countdown (s). Null when not derivable. [fixture-confirm]</summary>
    [SitrepUnit(Units.Seconds)]
    public double? DeathClockSec { get; set; }
}

/// <summary>
/// Kerbalism feature toggles (auto-detected from the loaded profile). Drives the
/// per-domain "unmodeled vs healthy" gate, under RO, <c>Reliability</c> is false.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
[SitrepTopic("kerbalism.features")]
public class KerbalismFeatures
{
    [SitrepUnit(Units.Flag)]
    public bool? Reliability { get; set; }
    [SitrepUnit(Units.Flag)]
    public bool? Radiation { get; set; }
    [SitrepUnit(Units.Flag)]
    public bool? SpaceWeather { get; set; }
    [SitrepUnit(Units.Flag)]
    public bool? Shielding { get; set; }
    [SitrepUnit(Units.Flag)]
    public bool? LivingSpace { get; set; }
    [SitrepUnit(Units.Flag)]
    public bool? Comfort { get; set; }
    [SitrepUnit(Units.Flag)]
    public bool? Poisoning { get; set; }
    [SitrepUnit(Units.Flag)]
    public bool? Pressure { get; set; }
    [SitrepUnit(Units.Flag)]
    public bool? Habitat { get; set; }
    [SitrepUnit(Units.Flag)]
    public bool? Supplies { get; set; }
    [SitrepUnit(Units.Flag)]
    public bool? Science { get; set; }
    [SitrepUnit(Units.Flag)]
    public bool? Automation { get; set; }
    [SitrepUnit(Units.Flag)]
    public bool? Deploy { get; set; }
}
