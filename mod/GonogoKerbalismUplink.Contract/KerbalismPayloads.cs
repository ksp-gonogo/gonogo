using System.Collections.Generic;
using Sitrep.Contract;
#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace GonogoKerbalismUplink;

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
// TYPING-ONLY: these mirror, field-for-field, the
// Dictionary<string, object?> value trees KerbalismCapture.Build* emit (camelCase
// wire keys via RtConfig.CamelCaseForProperties). They add no wire bytes; the
// wire is written by JsonWriter walking the uplink's live value tree. All members
// are nullable to mirror the permissive-on-absence convention; a live payload
// always carries concrete values.
//
// These types used to live in mod/Sitrep.Contract/KerbalismPayloads.cs. They
// were relocated into this Uplink's own contract slice per the mandate that no
// uplink-specific wire type may live in core: see this project's .csproj header
// and local_docs/design/2026-08-10-uplink-types-out-of-core-plan.md. The wire
// FORMAT is untouched; only the declaring assembly changed.
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
///
/// <para><b>This payload names no vessel, deliberately.</b> Solar activity is
/// SUN-sourced: the storms, the ejection speed and the star geometry describe
/// what the Sun is doing, and the intended shape for this channel is a
/// sun-sourced one delayed by its own Sun-to-observer geometry rather than a
/// vessel-attributed sample, per
/// <c>local_docs/design/2026-08-10-spaceweather-sun-and-vantage.md</c>. Binding
/// it to a vessel id would encode the wrong subject and have to be unpicked.
/// Distinct from <see cref="KerbalismFeatures"/>/<see cref="KerbalismProfile"/>,
/// which are install-wide facts with no subject to name at all; this one HAS a
/// subject, and it is the Sun.</para>
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
    /// <summary>
    /// One entry per star Kerbalism enumerates (<c>Sim.suns</c>, populated from
    /// Kopernicus <c>LightShifter</c> bodies, or the stock single sun when none
    /// are found), this vessel's own vantage on each
    /// (<c>VesselData.EnvSunsInfo</c>). Star-agnostic: 1..N entries, uniform
    /// shape for a binary/trinary pack same as a single star.
    /// </summary>
    public List<KerbalismStarInfo>? Stars { get; set; }
    /// <summary>
    /// One entry per (this vessel's current SOI body, star) CME slot,
    /// <c>Storm.StormKey(body, star)</c>-keyed. See
    /// <see cref="KerbalismStormEntry"/> for the fair-vs-cheating read boundary
    /// that governs which of its members are populated.
    /// </summary>
    public List<KerbalismStormEntry>? Storms { get; set; }
    /// <summary>
    /// Global CME transit speed, <c>PreferencesRadiation.Instance.StormEjectionSpeed</c>
    /// (a fraction of c; stock default 0.33c &#x2248; 99,000 km/s, read live in case a
    /// save overrides it). ONE value shared by every storm on every body/star pair,
    /// never per-storm (confirmed against Kerbalism source: <c>Storm.Time_to_impact</c>
    /// reads the same global preference for every call).
    /// </summary>
    [SitrepUnit(Units.MetresPerSecond)]
    public double? StormEjectionSpeed { get; set; }
}

/// <summary>
/// One star's vantage from the active vessel (Kerbalism's
/// <c>VesselData.EnvSunsInfo</c> entry, i.e. <c>SunInfo</c>). Join key onto
/// <see cref="KerbalismStormEntry.Star"/> is <see cref="Star"/> (the star's
/// <c>CelestialBody.bodyName</c>).
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class KerbalismStarInfo
{
    /// <summary>Star body name (<c>Sim.SunData.body.bodyName</c>).</summary>
    [SitrepUnit(Units.Text)]
    public string? Star { get; set; }
    /// <summary>Normalized vessel-to-sun direction, <c>VesselData.SunInfo.Direction</c>.</summary>
    [SitrepUnit(Units.Dimensionless)]
    public Vec3? Direction { get; set; }
    /// <summary>Vessel-to-sun-surface distance, <c>VesselData.SunInfo.Distance</c>.</summary>
    [SitrepUnit(Units.Metres)]
    public double? Distance { get; set; }
}

/// <summary>
/// One (this vessel's current SOI body, star) CME slot,
/// <c>Storm.StormKey(body, star)</c>-keyed against Kerbalism's own
/// <c>StormData</c>.
///
/// <para><b>FAIR-vs-CHEATING boundary.</b> <see cref="StormState"/> mirrors
/// <c>StormData.storm_state</c> (0 none / 1 inbound-in-transit / 2 in
/// progress-arrived) and is always read. <see cref="StormTime"/>,
/// <see cref="StormDuration"/> and <see cref="Dist"/> are populated ONLY when
/// <see cref="StormState"/> is nonzero: <c>Storm.CreateStorm</c> sets
/// <c>storm_time</c>/<c>storm_duration</c> and flips <c>storm_state</c> from 0
/// to 1 atomically, in the same call, on a successful roll, so reading all
/// three together observes one already-launched CME, never a future one. When
/// <c>storm_state</c> is 0 these are genuinely absent state on the Kerbalism
/// side too (<c>StormData.Reset()</c> zeroes them), so null is the honest
/// value, not a withheld one.</para>
///
/// <para><c>StormData.storm_generation</c> (the UT of the NEXT roll attempt,
/// win or lose) is NEVER read or shipped anywhere in this contract, by design.
/// Unlike <c>storm_time</c>/<c>storm_state</c> it is always populated whether
/// or not a storm currently exists, so reading it would expose the RNG's
/// schedule for an event that may never happen: information no in-universe
/// sun-watcher could observe. This is the one deliberate omission in an
/// otherwise "capture everything knowable" field, and it must stay that way.</para>
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class KerbalismStormEntry
{
    /// <summary>Source star body name. Join key onto <see cref="KerbalismStarInfo.Star"/>.</summary>
    [SitrepUnit(Units.Text)]
    public string? Star { get; set; }
    /// <summary><c>StormData.storm_state</c>: 0 none, 1 inbound (in transit), 2 in progress (arrived).</summary>
    [SitrepUnit(Units.Count)]
    public int? StormState { get; set; }
    /// <summary>Arrival UT, <c>StormData.storm_time</c>. Null when <see cref="StormState"/> is 0.</summary>
    [SitrepUnit(Units.Seconds)]
    public double? StormTime { get; set; }
    /// <summary>Storm duration once it hits, <c>StormData.storm_duration</c>. Null when <see cref="StormState"/> is 0.</summary>
    [SitrepUnit(Units.Seconds)]
    public double? StormDuration { get; set; }
    /// <summary>
    /// Live sun-to-body distance (<c>Vector3d.Distance(body.position,
    /// star.position)</c>, the identical geometry <c>Storm.Update</c> itself
    /// computes). Kerbalism does not persist the roll-time distance on
    /// <c>StormData</c>, so this is the CURRENT distance, not necessarily the
    /// exact one the roll used; the two diverge only by however far the body
    /// has moved in its orbit since the roll, negligible at interplanetary
    /// scale. Null when <see cref="StormState"/> is 0.
    /// </summary>
    [SitrepUnit(Units.Metres)]
    public double? Dist { get; set; }
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
    /// <summary>
    /// The live modifier product k, Kerbalism's own
    /// <c>Modifiers.Evaluate(vessel, vesselData, vesselResources, modifiers)</c>,
    /// evaluated over the matched <see cref="KerbalismProcessDef.Modifiers"/>
    /// list MINUS the capacity join token (<see cref="Resource"/> itself,
    /// already accounted for via <see cref="Capacity"/>, so including it here
    /// too would double-count it). Multiply into the nominal per-capacity rate
    /// (<c>KerbalismProcessDef</c> input/output * <see cref="Capacity"/>) for
    /// the actual rate. Null when Kerbalism's internals moved or the join
    /// could not be resolved; a consumer should treat null as 1.0 (no
    /// correction applied), same as an absent term elsewhere on this contract.
    /// </summary>
    [SitrepUnit(Units.Dimensionless)]
    public double? EnvModifier { get; set; }
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
    [SitrepUnit(Units.ResourceUnitsPerSecond)]
    public Dictionary<string, double>? Inputs { get; set; }
    /// <summary>Resource name -> rate per unit of process capacity, per second.</summary>
    [SitrepUnit(Units.ResourceUnitsPerSecond)]
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
    /// </summary>
    [SitrepUnit(Units.ResourceUnitsPerSecond)]
    public Dictionary<string, double>? Rates { get; set; }
    public KerbalismHabitat? Habitat { get; set; }

    /// <summary>
    /// The per-part process list, with a THREE-WAY absence that a consumer must
    /// respect: a populated list is what is running, an EMPTY list means the
    /// craft was read and carries no processes, and NULL means the list could
    /// not be read at all for this craft this tick.
    ///
    /// <para>Null happens for a background craft: KSP discards a vessel's
    /// <c>Part</c> objects when it unloads, and every process fact here (which
    /// part, its title, whether it is broken, its dump valve) lives on the part
    /// module. Kerbalism keeps simulating the craft's processes from a
    /// pseudo-resource, so the SUPPLIES and rates alongside this field are real
    /// while the per-part detail is simply unavailable. Rendering null as "no
    /// processes running" would turn a gap in our reading into a false
    /// statement about the craft, which is why it is not an empty list.</para>
    /// </summary>
    public List<KerbalismProcessEntry>? Processes { get; set; }
    /// <summary>
    /// Live modifier product k per rule name, keyed to join against
    /// <see cref="KerbalismRuleDef.Name"/> on <c>kerbalism.profile.rules</c>
    /// (same math as <see cref="KerbalismProcessEntry.EnvModifier"/>: Kerbalism's
    /// own <c>Modifiers.Evaluate</c>, over the rule's full modifier list, no
    /// capacity-token exclusion since a rule has no pseudo-resource join key).
    ///
    /// <para>Rides THIS live/delayed channel rather than living directly on
    /// <see cref="KerbalismRuleDef"/> because <c>kerbalism.profile</c> is a
    /// pull-style channel whose mapper is declared KSP-free and runs off the
    /// main thread (<c>IUplinkHost.AddChannelSource</c>), while a live
    /// vessel/environment read like <c>Modifiers.Evaluate</c> needs
    /// <c>VesselData</c>/<c>VesselResources</c> and must run on the main thread
    /// (see <c>IUplinkHost.AddSampledSource</c>'s doc comment: a Courier-thread
    /// live-KSP read is a crash risk, not a style nit) &#x2014; exactly the thread
    /// this <c>kerbalism.lifesupport</c> Topic is already captured on. A rule
    /// name absent from this map means "no correction available"; a consumer
    /// should treat that as k = 1.0, same as a null
    /// <see cref="KerbalismProcessEntry.EnvModifier"/>.</para>
    /// </summary>
    [SitrepUnit(Units.Dimensionless)]
    public Dictionary<string, double>? RuleEnvModifiers { get; set; }
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

    /// <summary>
    /// The UT these values were last RECOMPUTED at by Kerbalism, which is not
    /// the UT they were read at and can be a long way behind it.
    ///
    /// <para>Kerbalism steps exactly ONE unloaded vessel per physics tick, the
    /// one that has waited longest, catching it up with the whole interval it
    /// waited. So a background craft's life support is integrated correctly and
    /// refreshed rarely: with N unloaded craft, every N ticks. That staleness is
    /// independent of comms delay and invisible without this stamp, a fleet
    /// readout would otherwise show a value from several ticks ago as though it
    /// were current.</para>
    ///
    /// <para>Null when Kerbalism's own last-evaluation marker could not be read,
    /// which is a statement of ignorance and never a substituted capture time:
    /// stamping the read time would claim a freshness we did not measure.</para>
    /// </summary>
    [SitrepUnit(Units.Seconds)]
    public double? AsOfUt { get; set; }
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

    /// <summary>
    /// The UT this kerbal's rule accumulators were last ADVANCED at, which for
    /// a kerbal aboard a background craft can be well behind the read time: the
    /// accumulators move on their vessel's Kerbalism turn, and unloaded craft
    /// take those turns one per tick, in rotation. Same meaning and same
    /// null-is-ignorance rule as <see cref="KerbalismLifeSupport.AsOfUt"/>, on
    /// each entry rather than on the list because two kerbals can be on
    /// different craft with different turns.
    /// </summary>
    [SitrepUnit(Units.Seconds)]
    public double? AsOfUt { get; set; }
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
