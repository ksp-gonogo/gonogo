using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The <c>parts.power</c> Topic payload: the active vessel's rolled-up
/// electric-charge production. A single object, or <c>null</c> when there is
/// no active vessel or it carries no solar panel, battery, electric-charge
/// converter or alternator. The parts themselves are itemised on
/// <c>vessel.parts</c>.
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
    /// <summary>
    /// Total electric-charge production in EC per second: the sum of every
    /// solar panel's live flow rate and every alternator's live output rate.
    /// Fuel cells are not included. Null when no finite total could be read.
    /// </summary>
    [SitrepUnit(Units.ResourceUnitsPerSecond)]
    public double? TotalProductionEc { get; set; }
}

/// <summary>
/// One entry in the <c>robotics.servos</c> Topic payload, a single Breaking
/// Ground robotic servo on the active vessel. The payload is a bare array of
/// these, or <c>null</c> when there is no active vessel or it carries no
/// servo; read <c>robotics.available</c> to tell those two apart.
///
/// <para><see cref="Type"/> is the servo kind as a plain string, not an enum.
/// The kinds are <c>"rotor"</c>, <c>"hinge"</c>, <c>"rotationServo"</c> and
/// <c>"piston"</c>, plus <c>"servo"</c> for a servo of a kind not recognised
/// (a part pack's own, or one a later KSP adds), which carries only the
/// readings every servo has.</para>
///
/// <para><b>Open set.</b> The kinds follow KSP's own <c>BaseServo</c> types, so
/// more may appear. Switch on the kinds you can draw and ignore the rest.</para>
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
    /// <para>kN is the unit KSP's editor shows for it, although the value acts
    /// as a torque on the rotor's joint.</para>
    /// <internal>
    /// <c>maxTorque</c> feeds the part's editor motor output line (localization
    /// token <c>#autoLOC_8002342</c>, "&lt;&lt;1&gt;&gt;kN max: Extra mass
    /// &lt;&lt;2&gt;&gt;t"), and also a Unity angular drive's
    /// <c>maximumForce</c>, which on an angular drive is a moment.
    /// </internal>
    /// </summary>
    [SitrepUnit(Units.Kilonewtons)]
    public double? MaxTorque { get; set; }
}

/// <summary>
/// The <c>robotics.available</c> Topic payload: a single object (or
/// <c>null</c> when there is no active vessel) whose one field states whether
/// the active vessel carries any Breaking Ground robotic servo. It is its own
/// Topic because the <c>robotics.servos</c> array is <c>null</c> both when
/// the vessel has no robotic parts and when there is no vessel, and a widget
/// needs to tell "no robotics on this craft" from "nothing to show".
///
/// <para>Not the same as the Breaking Ground DLC-presence fact
/// (<c>deployed.available</c>): this reflects parts on this vessel, so it is
/// delayed by light time, whereas DLC presence is known on the ground at
/// once.</para>
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
