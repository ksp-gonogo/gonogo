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
    public bool? Magnetosphere { get; set; }
    public bool? InnerBelt { get; set; }
    public bool? OuterBelt { get; set; }
    public bool? StormIncoming { get; set; }
    public bool? StormInProgress { get; set; }
    public bool? Blackout { get; set; }
    public bool? InSunlight { get; set; }
    /// <summary>Shielding resource amount/capacity (0 in the default profile; present under RO/Habitat).</summary>
    public double? ShieldingAmount { get; set; }
    public double? ShieldingCapacity { get; set; }
}

/// <summary>One life-support consumable: amount, capacity, signed net rate (units/s, negative = draining).</summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class KerbalismResource
{
    public double? Amount { get; set; }
    public double? Capacity { get; set; }
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
    public double? Volume { get; set; }
    public double? Surface { get; set; }
}

/// <summary>One ProcessController process (scrubber / recycler / fuel cell).</summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class KerbalismProcessEntry
{
    public string? Resource { get; set; }
    public string? Title { get; set; }
    public double? Capacity { get; set; }
    public bool? Running { get; set; }
    public bool? Broken { get; set; }
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
    public string? CropResource { get; set; }
    /// <summary>Derived continuous production rate, units/s (crop_size * crop_rate when active and lit; 0 when blocked).</summary>
    public double? FoodRatePerSec { get; set; }
    /// <summary>Natural light flux reaching the greenhouse, W/m^2 (<c>Greenhouse.Data.natural</c>).</summary>
    [SitrepUnit(Units.WattsPerSquareMetre)]
    public double? Natural { get; set; }
    /// <summary>Supplemental lamp light flux, W/m^2 (<c>Greenhouse.Data.artificial</c>).</summary>
    [SitrepUnit(Units.WattsPerSquareMetre)]
    public double? Artificial { get; set; }
    /// <summary>Persisted on/off KSPField, the player's own toggle, independent of whether it is currently producing.</summary>
    public bool? Active { get; set; }
    /// <summary>Blocking reason string (<c>Greenhouse.Data.issue</c>), e.g. the localized "insufficient lighting". Empty when growing normally.</summary>
    public string? Issue { get; set; }
    /// <summary>Part config: max lamp EC draw, units/s (<c>ec_rate</c>).</summary>
    public double? EcRateMaxPerSec { get; set; }
    /// <summary>Derived actual lamp EC draw this tick, units/s (0 when lamps are off or fully unlit by the sun).</summary>
    public double? LampEcDrawPerSec { get; set; }
    /// <summary>Part config: total light flux needed to grow, W/m^2 (<c>light_tolerance</c>).</summary>
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
    public KerbalismResource? Food { get; set; }
    public KerbalismResource? Water { get; set; }
    public KerbalismResource? Oxygen { get; set; }
    public KerbalismResource? ElectricCharge { get; set; }
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
    public string? Name { get; set; }
    /// <summary>Current accumulator value ("problem") from KerbalData.rules.</summary>
    public double? Value { get; set; }
    /// <summary>
    /// Per-rule degeneration rate (units/s) from Profile.rules[].degeneration.
    /// Stage-2 death-clock input. Confirmed against Kerbalism source: `Rule.degeneration`
    /// is a public double field (Profile/Rule.cs); values are set per-rule in
    /// GameData/KerbalismConfig/Profiles/Default.cfg.
    /// </summary>
    public double? DegenPerSec { get; set; }
    /// <summary>
    /// Fatal accumulator threshold from Profile.rules[].fatal_threshold. Confirmed
    /// against Kerbalism source (Profile/Rule.cs ctor defaults this to 1.0; the
    /// default profile overrides it only for the radiation rule, to 50.0,
    /// GameData/KerbalismConfig/Profiles/Default.cfg's radiation Rule block).
    /// </summary>
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
    public string? Name { get; set; }
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
    public bool? Reliability { get; set; }
    public bool? Radiation { get; set; }
    public bool? SpaceWeather { get; set; }
    public bool? Shielding { get; set; }
    public bool? LivingSpace { get; set; }
    public bool? Comfort { get; set; }
    public bool? Poisoning { get; set; }
    public bool? Pressure { get; set; }
    public bool? Habitat { get; set; }
    public bool? Supplies { get; set; }
    public bool? Science { get; set; }
    public bool? Automation { get; set; }
    public bool? Deploy { get; set; }
}
