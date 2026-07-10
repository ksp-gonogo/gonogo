using System.Collections.Generic;
#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// One solar panel in the <c>parts.power</c> payload's <c>solarPanels</c> array.
/// Typing-only mirror of <c>Sitrep.Host.PartsViewProvider.BuildSolarPanelEntry</c>
/// — every field nullable because each is read through <c>SnapshotDict.Get*</c>,
/// which yields <c>null</c> (not a sentinel) on absence. See
/// <see cref="PartsPower"/> for the "no wire change" rationale.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class SolarPanelEntry
{
    public string? PartName { get; set; }

    public string? PartId { get; set; }

    public string? DeployState { get; set; }

    public double? FlowRate { get; set; }

    public double? ChargeRate { get; set; }

    public double? SunAOA { get; set; }
}

/// <summary>
/// One battery in the <c>parts.power</c> payload's <c>batteries</c> array.
/// Typing-only mirror of <c>Sitrep.Host.PartsViewProvider.BuildBatteryEntry</c>.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class BatteryEntry
{
    public string? PartName { get; set; }

    public string? PartId { get; set; }

    public double? Current { get; set; }

    public double? Max { get; set; }
}

/// <summary>
/// One fuel cell in the <c>parts.power</c> payload's <c>fuelCells</c> array.
/// Typing-only mirror of <c>Sitrep.Host.PartsViewProvider.BuildFuelCellEntry</c>.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class FuelCellEntry
{
    public string? PartName { get; set; }

    public string? PartId { get; set; }

    public bool? Active { get; set; }

    public string? Status { get; set; }
}

/// <summary>
/// One engine alternator in the <c>parts.power</c> payload's <c>alternators</c>
/// array. Typing-only mirror of
/// <c>Sitrep.Host.PartsViewProvider.BuildAlternatorEntry</c>.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class AlternatorEntry
{
    public string? PartName { get; set; }

    public string? PartId { get; set; }

    public double? OutputRate { get; set; }
}

/// <summary>
/// The <c>parts.power</c> channel payload — the active vessel's electric-charge
/// production surface (solar panels, batteries, fuel cells, engine
/// alternators, and a rolled-up production total). Unlike the bare-array
/// <c>parts.robotics</c> and the <c>science.*</c> channels, this payload is a
/// single WRAPPER OBJECT (or <c>null</c> when there is no active vessel / no
/// power sub-group) — so the Topic tag sits on this type directly with the
/// default <c>IsArray = false</c>.
///
/// <para><b>Typing-only mirror.</b> This reproduces, field-for-field, the exact
/// serialized shape <c>Sitrep.Host.PartsViewProvider.BuildPower</c> already
/// emits (same names, same camelCase wire keys via
/// <c>RtConfig.CamelCaseForProperties</c>, same units). It is NOT serialized
/// itself — the wire is written by <c>JsonWriter</c> walking the provider's
/// dictionary — so adding it changes no bytes. The four arrays and the total
/// are each nullable to mirror the provider (the arrays are always present in
/// the emitted object, but the contract stays permissive; the total is
/// <c>null</c> whenever <c>SnapshotDict.GetDouble</c> reads no finite value).</para>
/// </summary>
[SitrepContract]
[SitrepTopic("parts.power")]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class PartsPower
{
    public List<SolarPanelEntry>? SolarPanels { get; set; }

    public List<BatteryEntry>? Batteries { get; set; }

    public List<FuelCellEntry>? FuelCells { get; set; }

    public List<AlternatorEntry>? Alternators { get; set; }

    public double? TotalProductionEc { get; set; }
}

/// <summary>
/// One entry in the <c>parts.robotics</c> channel payload — a single Breaking
/// Ground robotic servo (rotor / hinge / piston) on the active vessel. The
/// channel payload is a BARE ARRAY of these (<c>ServoEntry[]</c>) or
/// <c>null</c> — never a wrapper object — so the Topic tag sits on this
/// element type with <c>IsArray = true</c>.
///
/// <para><see cref="Type"/> is the servo kind as a plain string on the wire
/// (<c>"rotor"</c> / <c>"hinge"</c> / <c>"piston"</c>), NOT an enum — mirroring
/// what the provider emits today; the enum cleanup is a later phase.</para>
///
/// <para><b>Typing-only mirror</b> of
/// <c>Sitrep.Host.PartsViewProvider.BuildServoEntry</c> — see
/// <see cref="PartsPower"/> for the "no wire change, all fields nullable"
/// rationale.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("parts.robotics", isArray: true)]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class ServoEntry
{
    public string? PartName { get; set; }

    public string? PartId { get; set; }

    public string? Type { get; set; }

    public bool? ServoIsLocked { get; set; }

    public bool? ServoIsMotorized { get; set; }

    public bool? ServoMotorIsEngaged { get; set; }

    public double? ServoMotorLimit { get; set; }

    public string? MotorState { get; set; }

    public double? CurrentAngle { get; set; }

    public double? TargetAngle { get; set; }

    public double? TraverseVelocity { get; set; }

    public double? CurrentRPM { get; set; }

    public double? RpmLimit { get; set; }

    public double? NormalizedOutput { get; set; }

    public double? BrakePercentage { get; set; }

    public double? CurrentExtension { get; set; }

    public double? TargetExtension { get; set; }
}

/// <summary>
/// The <c>robotics.available</c> channel payload — a single wrapper object
/// (or <c>null</c> when there is no active vessel) whose one field states
/// whether the active vessel carries ANY Breaking Ground robotic servo
/// (rotor / hinge / piston). This is deliberately its OWN Topic, not a field
/// folded into the bare-array <c>parts.robotics</c>: an empty
/// <c>ServoEntry[]</c> can't disambiguate "vessel has no robotic parts"
/// (<c>available: false</c>) from "no snapshot / no active vessel"
/// (payload <c>null</c>) — the very ambiguity a widget like
/// <c>RoboticsConsole</c> / <c>RotorTachometer</c> needs resolved to decide
/// whether to render a "no robotics on this craft" empty state versus stay
/// dark. It is DISTINCT from the Breaking-Ground DLC-presence fact (that is
/// the <c>deployed.available</c> / <c>Meta.Dlc</c> build) — this reflects
/// parts present on THIS vessel, so it rides the delay clock (Delayed),
/// whereas DLC presence is a ground-side TrueNow fact.
///
/// <para><see cref="Available"/> is nullable to mirror
/// <c>SnapshotDict.GetBool</c>'s null-on-absence rule — a snapshot recorded
/// before this field existed reads as <c>null</c>; a live snapshot always
/// carries a concrete <c>true</c>/<c>false</c>.</para>
///
/// <para><b>Typing-only mirror</b> of
/// <c>Sitrep.Host.PartsViewProvider.BuildRoboticsAvailable</c> — see
/// <see cref="PartsPower"/> for the "no wire change" rationale.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("robotics.available")]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class RoboticsAvailability
{
    public bool? Available { get; set; }
}
