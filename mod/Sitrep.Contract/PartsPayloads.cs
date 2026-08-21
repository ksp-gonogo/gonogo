using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// One solar panel in the <c>parts.power</c> payload's <c>solarPanels</c> array.
/// Typing-only mirror of <c>Sitrep.Host.PartsViewProvider.BuildSolarPanelEntry</c>,
/// every field nullable because each is read through <c>SnapshotDict.Get*</c>,
/// which yields <c>null</c> (not a sentinel) on absence. See
/// <see cref="PartsPower"/> for the "no wire change" rationale.
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class SolarPanelEntry
{
    [SitrepUnit(Units.Text)]
    public string? PartName { get; set; }

    [SitrepUnit(Units.Id)]
    public string? PartId { get; set; }

    [SitrepUnit(Units.Text)]
    public string? DeployState { get; set; }

    [SitrepUnit(Units.ResourceUnitsPerSecond)]
    public double? FlowRate { get; set; }

    [SitrepUnit(Units.ResourceUnitsPerSecond)]
    public double? ChargeRate { get; set; }

    [SitrepUnit(Units.Degrees)]
    public double? SunAOA { get; set; }
}

/// <summary>
/// One battery in the <c>parts.power</c> payload's <c>batteries</c> array.
/// Typing-only mirror of <c>Sitrep.Host.PartsViewProvider.BuildBatteryEntry</c>.
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class BatteryEntry
{
    [SitrepUnit(Units.Text)]
    public string? PartName { get; set; }

    [SitrepUnit(Units.Id)]
    public string? PartId { get; set; }

    [SitrepUnit(Units.ResourceUnits)]
    public double? Current { get; set; }

    [SitrepUnit(Units.ResourceUnits)]
    public double? Max { get; set; }
}

/// <summary>
/// One fuel cell in the <c>parts.power</c> payload's <c>fuelCells</c> array.
/// Typing-only mirror of <c>Sitrep.Host.PartsViewProvider.BuildFuelCellEntry</c>.
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class FuelCellEntry
{
    [SitrepUnit(Units.Text)]
    public string? PartName { get; set; }

    [SitrepUnit(Units.Id)]
    public string? PartId { get; set; }

    [SitrepUnit(Units.Flag)]
    public bool? Active { get; set; }

    [SitrepUnit(Units.Text)]
    public string? Status { get; set; }
}

/// <summary>
/// One engine alternator in the <c>parts.power</c> payload's <c>alternators</c>
/// array. Typing-only mirror of
/// <c>Sitrep.Host.PartsViewProvider.BuildAlternatorEntry</c>.
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class AlternatorEntry
{
    [SitrepUnit(Units.Text)]
    public string? PartName { get; set; }

    [SitrepUnit(Units.Id)]
    public string? PartId { get; set; }

    [SitrepUnit(Units.ResourceUnitsPerSecond)]
    public double? OutputRate { get; set; }
}

/// <summary>
/// The <c>parts.power</c> channel payload: the active vessel's electric-charge
/// production surface (solar panels, batteries, fuel cells, engine
/// alternators, and a rolled-up production total). Unlike the bare-array
/// <c>robotics.servos</c> and the <c>science.*</c> channels, this payload is a
/// single WRAPPER OBJECT (or <c>null</c> when there is no active vessel / no
/// power sub-group): so the Topic tag sits on this type directly with the
/// default <c>IsArray = false</c>.
///
/// <para><b>Typing-only mirror.</b> This reproduces, field-for-field, the exact
/// serialized shape <c>Sitrep.Host.PartsViewProvider.BuildPower</c> already
/// emits (same names, same camelCase wire keys via
/// <c>RtConfig.CamelCaseForProperties</c>, same units). It is NOT serialized
/// itself: the wire is written by <c>JsonWriter</c> walking the provider's
/// dictionary: so adding it changes no bytes. The four arrays and the total
/// are each nullable to mirror the provider (the arrays are always present in
/// the emitted object, but the contract stays permissive; the total is
/// <c>null</c> whenever <c>SnapshotDict.GetDouble</c> reads no finite value).</para>
/// </summary>
[SitrepContract]
[SitrepTopic("parts.power")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class PartsPower
{
    public List<SolarPanelEntry>? SolarPanels { get; set; }

    public List<BatteryEntry>? Batteries { get; set; }

    public List<FuelCellEntry>? FuelCells { get; set; }

    public List<AlternatorEntry>? Alternators { get; set; }

    [SitrepUnit(Units.ResourceUnitsPerSecond)]
    public double? TotalProductionEc { get; set; }
}

/// <summary>
/// One entry in the <c>robotics.servos</c> channel payload, a single Breaking
/// Ground robotic servo on the active vessel. The channel payload is a BARE
/// ARRAY of these (<c>ServoEntry[]</c>) or <c>null</c> (never a wrapper
/// object) so the Topic tag sits on this element type with
/// <c>IsArray = true</c>.
///
/// <para><see cref="Type"/> is the servo kind as a plain string on the wire,
/// NOT an enum, mirroring what the provider emits today; the enum cleanup is
/// a later phase. The kinds are <c>"rotor"</c>, <c>"hinge"</c>,
/// <c>"rotationServo"</c> and <c>"piston"</c>, plus <c>"servo"</c> for a
/// <c>BaseServo</c> subclass the capture does not recognise (a part pack's
/// own, or one a later KSP adds), which carries only the readings every servo
/// has.</para>
///
/// <para><b>This list is a description, not a rule.</b> The capture derives
/// the kinds from <c>BaseServo</c> itself rather than from any written-down
/// set, which is the whole point: the set used to be written down, rotation
/// servos were left out of it, and every one on every craft was dropped
/// before it reached the wire. A consumer should switch on the kinds it can
/// draw and ignore the rest, never assume this sentence is exhaustive.</para>
///
/// <para><b>Typing-only mirror</b> of
/// <c>Sitrep.Host.BreakingGroundViewProvider.BuildServoEntry</c>: see
/// <see cref="PartsPower"/> for the "no wire change, all fields nullable"
/// rationale.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("robotics.servos", isArray: true)]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class ServoEntry
{
    [SitrepUnit(Units.Text)]
    public string? PartName { get; set; }

    [SitrepUnit(Units.Id)]
    public string? PartId { get; set; }

    [SitrepUnit(Units.Id)]
    public string? Type { get; set; }

    [SitrepUnit(Units.Flag)]
    public bool? ServoIsLocked { get; set; }

    [SitrepUnit(Units.Flag)]
    public bool? ServoIsMotorized { get; set; }

    [SitrepUnit(Units.Flag)]
    public bool? ServoMotorIsEngaged { get; set; }

    [SitrepUnit(Units.Percent)]
    public double? ServoMotorLimit { get; set; }

    [SitrepUnit(Units.Text)]
    public string? MotorState { get; set; }

    [SitrepUnit(Units.Degrees)]
    public double? CurrentAngle { get; set; }

    [SitrepUnit(Units.Degrees)]
    public double? TargetAngle { get; set; }

    [SitrepUnit(Units.NotApplicable)]
    public double? TraverseVelocity { get; set; }

    [SitrepUnit(Units.Rpm)]
    public double? CurrentRPM { get; set; }

    [SitrepUnit(Units.Rpm)]
    public double? RpmLimit { get; set; }

    [SitrepUnit(Units.Ratio)]
    public double? NormalizedOutput { get; set; }

    [SitrepUnit(Units.Percent)]
    public double? BrakePercentage { get; set; }

    [SitrepUnit(Units.Metres)]
    public double? CurrentExtension { get; set; }

    [SitrepUnit(Units.Metres)]
    public double? TargetExtension { get; set; }

    /// <summary>
    /// Rotor spin direction (rotor entries only: <c>null</c> for every other kind).
    /// Mirrors <c>ModuleRoboticServoRotor.rotateCounterClockwise</c>: <c>true</c>
    /// means the rotor spins counter-clockwise.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? CounterClockwise { get; set; }

    /// <summary>
    /// Rotor torque ceiling in kN (rotor entries only, <c>null</c> for every
    /// other kind). Mirrors <c>ModuleRoboticServoRotor.maxTorque</c>: the
    /// scale <c>ServoMotorLimit</c> (a percentage) is a fraction of.
    ///
    /// <para>The unit is kN, per KSP's own editor UI: <c>maxTorque</c> feeds
    /// <c>motorOutputInformation</c>, the part's editor-visible display,
    /// formatted with localization token <c>#autoLOC_8002342</c>
    /// ("&lt;&lt;1&gt;&gt;kN max: Extra mass &lt;&lt;2&gt;&gt;t"). A
    /// decompile of <c>ModuleRoboticServoRotor</c> shows the same value also
    /// feeds a Unity angular drive's <c>maximumForce</c>, which on an
    /// angular drive is technically a moment, but the wire states what KSP's
    /// own UI labels it, and that label is kN.</para>
    /// </summary>
    [SitrepUnit(Units.Kilonewtons)]
    public double? MaxTorque { get; set; }
}

/// <summary>
/// The <c>robotics.available</c> channel payload: a single wrapper object
/// (or <c>null</c> when there is no active vessel) whose one field states
/// whether the active vessel carries ANY Breaking Ground robotic servo
/// (rotor / hinge / piston). This is deliberately its OWN Topic, not a field
/// folded into the bare-array <c>parts.robotics</c>: an empty
/// <c>ServoEntry[]</c> can't disambiguate "vessel has no robotic parts"
/// (<c>available: false</c>) from "no snapshot / no active vessel"
/// (payload <c>null</c>): the very ambiguity a widget like
/// <c>RoboticsConsole</c> / <c>RotorTachometer</c> needs resolved to decide
/// whether to render a "no robotics on this craft" empty state versus stay
/// dark. It is DISTINCT from the Breaking-Ground DLC-presence fact (that is
/// the <c>deployed.available</c> / <c>Meta.Dlc</c> build): this reflects
/// parts present on THIS vessel, so it rides the delay clock (Delayed),
/// whereas DLC presence is a ground-side TrueNow fact.
///
/// <para><see cref="Available"/> is nullable to mirror
/// <c>SnapshotDict.GetBool</c>'s null-on-absence rule: a snapshot recorded
/// before this field existed reads as <c>null</c>; a live snapshot always
/// carries a concrete <c>true</c>/<c>false</c>.</para>
///
/// <para><b>Typing-only mirror</b> of
/// <c>Sitrep.Host.BreakingGroundViewProvider.BuildRoboticsAvailable</c>: see
/// <see cref="PartsPower"/> for the "no wire change" rationale.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("robotics.available")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class RoboticsAvailability
{
    [SitrepUnit(Units.Flag)]
    public bool? Available { get; set; }
}
