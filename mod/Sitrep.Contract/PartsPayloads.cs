using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// One deployable solar panel module in the <c>parts.power</c> payload's
/// <c>solarPanels</c> array. A part with several panel modules contributes one
/// entry per module. Every field is <c>null</c> when its value could not be
/// read, never a sentinel.
/// <internal>
/// Typing-only mirror of <c>Sitrep.Host.PartsViewProvider.BuildSolarPanelEntry</c>;
/// every field is nullable because each is read through <c>SnapshotDict.Get*</c>,
/// which yields null on absence. The capture is <c>KspHost.BuildPartsPower</c>.
/// </internal>
/// </summary>
/// <category>Parts</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class SolarPanelEntry
{
    /// <summary>The part's display title (KSP's <c>Part.partInfo.title</c>), or its internal name when it has no part info.</summary>
    [SitrepUnit(Units.Text)]
    public string? PartName { get; set; }

    /// <summary>
    /// The part's <c>Part.flightID</c> as a string: unique per part for the life
    /// of the flight, so it tells apart symmetric parts that share a name. Null
    /// when the part has no flight id yet.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? PartId { get; set; }

    /// <summary>
    /// The panel's deploy state, KSP's <c>ModuleDeployablePart.DeployState</c>
    /// name as-is: <c>"RETRACTED"</c>, <c>"EXTENDING"</c>, <c>"EXTENDED"</c>,
    /// <c>"RETRACTING"</c> or <c>"BROKEN"</c>.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? DeployState { get; set; }

    /// <summary>The panel's current electric-charge output (KSP's <c>flowRate</c>), in EC per second. This is what counts toward <see cref="PartsPower.TotalProductionEc"/>.</summary>
    [SitrepUnit(Units.ResourceUnitsPerSecond)]
    public double? FlowRate { get; set; }

    /// <summary>The panel's rated charge rate from its part configuration (KSP's <c>chargeRate</c>), in EC per second, before sun exposure and distance are applied.</summary>
    [SitrepUnit(Units.ResourceUnitsPerSecond)]
    public double? ChargeRate { get; set; }

    /// <summary>
    /// KSP's <c>ModuleDeployableSolarPanel.sunAOA</c>: despite the name and the
    /// declared unit, a sun-exposure factor from 0 (no sunlight on the panel) to
    /// 1 (facing the sun squarely), not an angle.
    /// </summary>
    [SitrepUnit(Units.Degrees)]
    public double? SunAOA { get; set; }
}

/// <summary>
/// One electric-charge store in the <c>parts.power</c> payload's
/// <c>batteries</c> array: every part with an <c>ElectricCharge</c> capacity
/// above zero, so command pods and probe cores appear here as well as
/// batteries. Every field is <c>null</c> when its value could not be read.
/// <internal>
/// Typing-only mirror of <c>Sitrep.Host.PartsViewProvider.BuildBatteryEntry</c>.
/// </internal>
/// </summary>
/// <category>Parts</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class BatteryEntry
{
    /// <summary>The part's display title (KSP's <c>Part.partInfo.title</c>), or its internal name when it has no part info.</summary>
    [SitrepUnit(Units.Text)]
    public string? PartName { get; set; }

    /// <summary>The part's <c>Part.flightID</c> as a string, the same join key as <see cref="SolarPanelEntry.PartId"/>. Null when the part has no flight id yet.</summary>
    [SitrepUnit(Units.Id)]
    public string? PartId { get; set; }

    /// <summary>Electric charge currently held in this part, in EC.</summary>
    [SitrepUnit(Units.ResourceUnits)]
    public double? Current { get; set; }

    /// <summary>This part's electric-charge capacity, in EC.</summary>
    [SitrepUnit(Units.ResourceUnits)]
    public double? Max { get; set; }
}

/// <summary>
/// One electric-charge-producing converter in the <c>parts.power</c> payload's
/// <c>fuelCells</c> array: every <c>ModuleResourceConverter</c> whose outputs
/// include <c>ElectricCharge</c>, one entry per module. Every field is
/// <c>null</c> when its value could not be read.
/// <internal>
/// Typing-only mirror of <c>Sitrep.Host.PartsViewProvider.BuildFuelCellEntry</c>.
/// </internal>
/// </summary>
/// <category>Parts</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class FuelCellEntry
{
    /// <summary>The part's display title (KSP's <c>Part.partInfo.title</c>), or its internal name when it has no part info.</summary>
    [SitrepUnit(Units.Text)]
    public string? PartName { get; set; }

    /// <summary>The part's <c>Part.flightID</c> as a string, the same join key as <see cref="SolarPanelEntry.PartId"/>. Null when the part has no flight id yet.</summary>
    [SitrepUnit(Units.Id)]
    public string? PartId { get; set; }

    /// <summary>True when the converter is switched on (KSP's <c>IsActivated</c>).</summary>
    [SitrepUnit(Units.Flag)]
    public bool? Active { get; set; }

    /// <summary>The converter's own status text as KSP displays it (<c>ModuleResourceConverter.status</c>). Free text, not a fixed vocabulary.</summary>
    [SitrepUnit(Units.Text)]
    public string? Status { get; set; }
}

/// <summary>
/// One engine alternator module in the <c>parts.power</c> payload's
/// <c>alternators</c> array. Every field is <c>null</c> when its value could
/// not be read.
/// <internal>
/// Typing-only mirror of <c>Sitrep.Host.PartsViewProvider.BuildAlternatorEntry</c>.
/// </internal>
/// </summary>
/// <category>Parts</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class AlternatorEntry
{
    /// <summary>The part's display title (KSP's <c>Part.partInfo.title</c>), or its internal name when it has no part info.</summary>
    [SitrepUnit(Units.Text)]
    public string? PartName { get; set; }

    /// <summary>The part's <c>Part.flightID</c> as a string, the same join key as <see cref="SolarPanelEntry.PartId"/>. Null when the part has no flight id yet.</summary>
    [SitrepUnit(Units.Id)]
    public string? PartId { get; set; }

    /// <summary>The alternator's current electric-charge output (KSP's <c>ModuleAlternator.outputRate</c>), in EC per second.</summary>
    [SitrepUnit(Units.ResourceUnitsPerSecond)]
    public double? OutputRate { get; set; }
}

/// <summary>
/// The <c>parts.power</c> channel payload: the active vessel's electric-charge
/// production surface (solar panels, batteries, fuel cells, engine
/// alternators, and a rolled-up production total). A single object, or
/// <c>null</c> when there is no active vessel or it carries none of the four
/// kinds of part.
///
/// <para>When the payload is present all four arrays are present too, each
/// possibly empty; they are typed nullable so a client stays safe if one is
/// ever missing.</para>
/// <internal>
/// Typing-only mirror: this reproduces, field for field, the shape
/// <c>Sitrep.Host.PartsViewProvider.BuildPower</c> emits (same camelCase keys
/// via <c>RtConfig.CamelCaseForProperties</c>, same units). It is never
/// serialized itself; the wire is written by <c>JsonWriter</c> walking the
/// provider's dictionary, so this type changes no bytes. The total is null
/// whenever <c>SnapshotDict.GetDouble</c> reads no finite value.
/// </internal>
/// </summary>
/// <category>Parts</category>
[SitrepContract]
[SitrepTopic("parts.power")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class PartsPower
{
    /// <summary>Every deployable solar panel module on the vessel.</summary>
    public List<SolarPanelEntry>? SolarPanels { get; set; }

    /// <summary>Every part that stores electric charge.</summary>
    public List<BatteryEntry>? Batteries { get; set; }

    /// <summary>Every converter module that produces electric charge.</summary>
    public List<FuelCellEntry>? FuelCells { get; set; }

    /// <summary>Every engine alternator module on the vessel.</summary>
    public List<AlternatorEntry>? Alternators { get; set; }

    /// <summary>
    /// Total electric-charge production in EC per second: the sum of every
    /// solar panel's <see cref="SolarPanelEntry.FlowRate"/> and every
    /// alternator's <see cref="AlternatorEntry.OutputRate"/>. Fuel cells are not
    /// included. Null when no finite total could be read.
    /// </summary>
    [SitrepUnit(Units.ResourceUnitsPerSecond)]
    public double? TotalProductionEc { get; set; }
}

/// <summary>
/// One entry in the <c>robotics.servos</c> channel payload, a single Breaking
/// Ground robotic servo on the active vessel. The payload is a BARE ARRAY of
/// these, or <c>null</c> when there is no active vessel or it carries no
/// servo; read <c>robotics.available</c> to tell those two apart.
///
/// <para><see cref="Type"/> is the servo kind as a plain string, not an enum.
/// The kinds are <c>"rotor"</c>, <c>"hinge"</c>, <c>"rotationServo"</c> and
/// <c>"piston"</c>, plus <c>"servo"</c> for a servo of a kind not recognised
/// (a part pack's own, or one a later KSP adds), which carries only the
/// readings every servo has.</para>
///
/// <para><b>This list is a description, not a rule.</b> The kinds are derived
/// from KSP's <c>BaseServo</c> itself rather than from any written-down set. A
/// consumer should switch on the kinds it can draw and ignore the rest, never
/// assume this sentence is exhaustive.</para>
///
/// <para>Fields that belong to one kind are <c>null</c> on every other kind:
/// angles on hinges and rotation servos, extensions on pistons, and the rpm,
/// output, brake, direction and torque fields on rotors.</para>
/// <internal>
/// Typing-only mirror of <c>Sitrep.Host.BreakingGroundViewProvider.BuildServoEntry</c>;
/// the capture is <c>Gonogo.KSP.ServoCapture</c>.
/// </internal>
/// </summary>
/// <category>Parts</category>
[SitrepContract]
[SitrepTopic("robotics.servos", isArray: true)]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class ServoEntry
{
    /// <summary>The part's display title (KSP's <c>Part.partInfo.title</c>), or its internal name when it has no part info.</summary>
    [SitrepUnit(Units.Text)]
    public string? PartName { get; set; }

    /// <summary>
    /// The part's <c>Part.flightID</c> as a string: unique per part for the life
    /// of the flight, so it tells apart symmetric servos that share a name. Null
    /// when the part has no flight id yet.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? PartId { get; set; }

    /// <summary>
    /// The servo kind: <c>"rotor"</c>, <c>"hinge"</c>, <c>"rotationServo"</c>,
    /// <c>"piston"</c>, or <c>"servo"</c> for a kind not recognised. See this
    /// type's summary.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? Type { get; set; }

    /// <summary>True when the servo is locked in place (KSP's <c>BaseServo.servoIsLocked</c>).</summary>
    [SitrepUnit(Units.Flag)]
    public bool? ServoIsLocked { get; set; }

    /// <summary>True when the servo has a motor (KSP's <c>BaseServo.servoIsMotorized</c>).</summary>
    [SitrepUnit(Units.Flag)]
    public bool? ServoIsMotorized { get; set; }

    /// <summary>True when the servo's motor is engaged (KSP's <c>BaseServo.servoMotorIsEngaged</c>).</summary>
    [SitrepUnit(Units.Flag)]
    public bool? ServoMotorIsEngaged { get; set; }

    /// <summary>The motor's torque limit as a percentage (KSP's <c>BaseServo.servoMotorLimit</c>). On a rotor it is a percentage of <see cref="MaxTorque"/>.</summary>
    [SitrepUnit(Units.Percent)]
    public double? ServoMotorLimit { get; set; }

    /// <summary>The motor's state text as KSP displays it (<c>BaseServo.motorState</c>). Free text, not a fixed vocabulary.</summary>
    [SitrepUnit(Units.Text)]
    public string? MotorState { get; set; }

    /// <summary>Current angle in degrees. Hinges and rotation servos only.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? CurrentAngle { get; set; }

    /// <summary>Angle the servo is driving to, in degrees. Hinges and rotation servos only.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? TargetAngle { get; set; }

    /// <summary>
    /// KSP's <c>traverseVelocity</c> setting for hinges, rotation servos and
    /// pistons. Its unit follows the kind (KSP drives angles for the first two
    /// and an extension for a piston), so no single unit is declared.
    /// </summary>
    [SitrepUnit(Units.NotApplicable)]
    public double? TraverseVelocity { get; set; }

    /// <summary>The rotor's current speed in revolutions per minute. Rotors only.</summary>
    [SitrepUnit(Units.Rpm)]
    public double? CurrentRPM { get; set; }

    /// <summary>The rotor's rpm limit setting. Rotors only.</summary>
    [SitrepUnit(Units.Rpm)]
    public double? RpmLimit { get; set; }

    /// <summary>The rotor's normalised output (KSP's <c>ModuleRoboticServoRotor.normalizedOutput</c>). Rotors only.</summary>
    [SitrepUnit(Units.Ratio)]
    public double? NormalizedOutput { get; set; }

    /// <summary>The rotor's brake setting as a percentage (KSP's <c>brakePercentage</c>). Rotors only.</summary>
    [SitrepUnit(Units.Percent)]
    public double? BrakePercentage { get; set; }

    /// <summary>The piston's current extension in metres. Pistons only.</summary>
    [SitrepUnit(Units.Metres)]
    public double? CurrentExtension { get; set; }

    /// <summary>The extension the piston is driving to, in metres. Pistons only.</summary>
    [SitrepUnit(Units.Metres)]
    public double? TargetExtension { get; set; }

    /// <summary>
    /// Rotor spin direction (rotor entries only, <c>null</c> for every other
    /// kind). KSP's <c>ModuleRoboticServoRotor.rotateCounterClockwise</c>:
    /// <c>true</c> means the rotor spins counter-clockwise.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? CounterClockwise { get; set; }

    /// <summary>
    /// Rotor torque ceiling in kN (rotor entries only, <c>null</c> for every
    /// other kind). KSP's <c>ModuleRoboticServoRotor.maxTorque</c>: the scale
    /// <see cref="ServoMotorLimit"/> (a percentage) is a fraction of.
    ///
    /// <para>The unit is kN because that is how KSP's own editor UI labels
    /// it: <c>maxTorque</c> feeds the part's editor-visible motor output line
    /// (localization token <c>#autoLOC_8002342</c>,
    /// "&lt;&lt;1&gt;&gt;kN max: Extra mass &lt;&lt;2&gt;&gt;t"). The same
    /// value also feeds a Unity angular drive's <c>maximumForce</c>, which on an
    /// angular drive is technically a moment.</para>
    /// </summary>
    [SitrepUnit(Units.Kilonewtons)]
    public double? MaxTorque { get; set; }
}

/// <summary>
/// The <c>robotics.available</c> channel payload: a single object (or
/// <c>null</c> when there is no active vessel) whose one field states whether
/// the active vessel carries ANY Breaking Ground robotic servo. It is its own
/// Topic because the <c>robotics.servos</c> array is <c>null</c> both when
/// the vessel has no robotic parts and when there is no vessel, and a widget
/// needs to tell "no robotics on this craft" from "nothing to show".
///
/// <para>It is DISTINCT from the Breaking Ground DLC-presence fact
/// (<c>deployed.available</c>): this reflects parts present on THIS vessel,
/// so it is Delayed, whereas DLC presence is a ground-side TrueNow
/// fact.</para>
///
/// <para><see cref="Available"/> is three-state. <c>null</c> means the craft
/// could not be surveyed: a recording that does not carry this field, or a
/// live read where one part could not be read, since "no robotic parts" is a
/// claim about every part. <c>false</c> is the definite "this craft carries
/// none". A reader that treats null as false tells the operator there are no
/// robotic parts on a craft that may be full of them.</para>
/// <internal>
/// Typing-only mirror of <c>Sitrep.Host.BreakingGroundViewProvider.BuildRoboticsAvailable</c>.
/// </internal>
/// </summary>
/// <category>Parts</category>
[SitrepContract]
[SitrepTopic("robotics.available")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class RoboticsAvailability
{
    /// <summary>True when the vessel carries at least one robotic servo, false when it definitely carries none, null when it could not be surveyed.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? Available { get; set; }
}
