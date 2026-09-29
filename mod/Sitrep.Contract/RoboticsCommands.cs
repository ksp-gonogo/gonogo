#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Args for the servo target commands (<c>robotics.servo.setTarget</c>),
/// the ABSOLUTE angle (hinge) or extension (piston) to drive to, keyed by
/// the part's <see cref="PartId"/>. <see cref="PartId"/> is the same
/// <c>flightID</c> string <c>parts.robotics</c> publishes on each servo
/// entry, so a widget sends back the exact id it displays. A rotor has no
/// target (it spins continuously); a <c>setTarget</c> aimed at one fails with
/// <see cref="CommandResult.ErrorCode"/> <see cref="CommandErrorCode.ModeUnavailable"/>.
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("robotics.servo.setTarget")]
public class ServoSetTargetArgs
{
    /// <summary>The part's <c>flightID.ToString()</c>: the id the read side stamps on each <c>parts.robotics</c> entry.</summary>
    [SitrepUnit(Units.Id)]
    public string PartId { get; set; } = "";

    /// <summary>Absolute target: hinge angle (degrees) or piston extension.</summary>
    [SitrepUnit(Units.Ratio)]
    public double Value { get; set; }
}

/// <summary>
/// Args shared by every robotics boolean actuation
/// (<c>robotics.servo.setMotor</c>/<c>setLock</c> and
/// <c>robotics.rotor.setMotor</c>/<c>setLock</c>): an absolute state to
/// apply, never a toggle, like every other actuation command (see
/// <see cref="SetEnabledArgs"/>). Keyed by <see cref="PartId"/>, the
/// <c>flightID</c> string <c>parts.robotics</c> publishes.
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("robotics.servo.setMotor")]
[SitrepCommand("robotics.servo.setLock")]
[SitrepCommand("robotics.rotor.setMotor")]
[SitrepCommand("robotics.rotor.setLock")]
public class ServoSetEnabledArgs
{
    /// <summary>The part's <c>flightID.ToString()</c>: the id the read side stamps on each <c>parts.robotics</c> entry.</summary>
    [SitrepUnit(Units.Id)]
    public string PartId { get; set; } = "";

    /// <summary>The state to apply: for <c>setMotor</c>, <c>true</c> engages the part's motor and <c>false</c> disengages it; for <c>setLock</c>, <c>true</c> locks the part and <c>false</c> unlocks it. <c>setMotor</c> on a servo with no motor fails with <see cref="CommandErrorCode.CapabilityMismatch"/>.</summary>
    [SitrepUnit(Units.Flag)]
    public bool Enabled { get; set; }
}

/// <summary>
/// Args for the rotor scalar-limit commands
/// (<c>robotics.rotor.setRpmLimit</c>/<c>setTorqueLimit</c>/<c>setBrake</c>),
/// the ABSOLUTE value to apply, keyed by <see cref="PartId"/>. The bounded
/// ones (torque 0 to 100, brake 0 to 200) are range-checked before they are
/// sent; out of range fails with <see cref="CommandResult.ErrorCode"/>
/// <see cref="CommandErrorCode.Range"/>.
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("robotics.rotor.setRpmLimit")]
[SitrepCommand("robotics.rotor.setTorqueLimit")]
[SitrepCommand("robotics.rotor.setBrake")]
public class RotorSetValueArgs
{
    /// <summary>The part's <c>flightID.ToString()</c>: the id the read side stamps on each <c>parts.robotics</c> entry.</summary>
    [SitrepUnit(Units.Id)]
    public string PartId { get; set; } = "";

    /// <summary>The absolute value to apply: the rpm limit, the torque-limit percent (0 to 100), or the brake percent (0 to 200).</summary>
    [SitrepUnit(Units.Ratio)]
    public double Value { get; set; }
}

/// <summary>
/// Args for <c>robotics.rotor.reverse</c>: flips the rotor's spin direction.
/// This is the one robotics command that is genuinely a toggle (the widget's
/// intent is "spin the other way" relative to whatever the rotor is doing
/// now), so it carries no state field, only the <see cref="PartId"/> to act
/// on.
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("robotics.rotor.reverse")]
public class RotorReverseArgs
{
    /// <summary>The part's <c>flightID.ToString()</c>: the id the read side stamps on each <c>parts.robotics</c> entry.</summary>
    [SitrepUnit(Units.Id)]
    public string PartId { get; set; } = "";
}
