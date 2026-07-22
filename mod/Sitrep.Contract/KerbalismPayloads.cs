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
// and the ProcessController PartModules — the SAME reflection the proven
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
// NOT here — same treatment as scansat.available.
// ─────────────────────────────────────────────────────────────────────────────

/// <summary>
/// Space-weather situation for the active vessel — radiation, magnetic belts,
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
    /// <summary>Raw <c>API.Radiation(v)</c>. Units [fixture-confirm]: Kerbalism source is rad/s; the client multiplies by 3600 for rad/h.</summary>
    public double? RadiationRadPerSecond { get; set; }
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
    public double? Pressure { get; set; }
    public double? Poisoning { get; set; }
    public double? Shielding { get; set; }
    public double? LivingSpace { get; set; }
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
    /// <summary>Per-rule degeneration rate (units/s) from Profile.rules[].degeneration. Stage-2 death-clock input. [fixture-confirm]</summary>
    public double? DegenPerSec { get; set; }
    /// <summary>Fatal accumulator threshold from Profile.rules[].fatal_threshold. [fixture-confirm]</summary>
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
    public double? DeathClockSec { get; set; }
}

/// <summary>
/// Kerbalism feature toggles (auto-detected from the loaded profile). Drives the
/// per-domain "unmodeled vs healthy" gate — under RO, <c>Reliability</c> is false.
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
