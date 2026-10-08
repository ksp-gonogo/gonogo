#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Args for <c>robotics.servo.setTarget</c>: the absolute angle (hinge) or
/// extension (piston) to drive to, keyed by the part's
/// <see cref="PartId"/>. <see cref="PartId"/> is the same
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

    /// <summary>Absolute target. Its unit follows the part's kind: degrees for a hinge or rotation servo, metres for a piston.</summary>
    [SitrepUnit(Units.NotApplicable)]
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
/// Args for <c>robotics.rotor.setRpmLimit</c>: the absolute rpm cap to apply,
/// keyed by <see cref="PartId"/>.
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("robotics.rotor.setRpmLimit")]
public class RotorSetRpmLimitArgs
{
    /// <summary>The part's <c>flightID.ToString()</c>: the id the read side stamps on each <c>parts.robotics</c> entry.</summary>
    [SitrepUnit(Units.Id)]
    public string PartId { get; set; } = "";

    /// <summary>The rpm cap to apply, in revolutions per minute.</summary>
    [SitrepUnit(Units.Rpm)]
    public double Rpm { get; set; }
}

/// <summary>
/// Args for <c>robotics.rotor.setTorqueLimit</c>: the absolute torque limit to
/// apply, keyed by <see cref="PartId"/>. A value outside 0 to 100 fails with
/// <see cref="CommandErrorCode.Range"/>.
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("robotics.rotor.setTorqueLimit")]
public class RotorSetTorqueLimitArgs
{
    /// <summary>The part's <c>flightID.ToString()</c>: the id the read side stamps on each <c>parts.robotics</c> entry.</summary>
    [SitrepUnit(Units.Id)]
    public string PartId { get; set; } = "";

    /// <summary>The torque limit as a percentage of the rotor's maximum torque, 0 to 100.</summary>
    [SitrepUnit(Units.Percent)]
    public double Percent { get; set; }
}

/// <summary>
/// Args for <c>robotics.rotor.setBrake</c>: the absolute brake strength to
/// apply, keyed by <see cref="PartId"/>. A value outside 0 to 200 fails with
/// <see cref="CommandErrorCode.Range"/>.
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("robotics.rotor.setBrake")]
public class RotorSetBrakeArgs
{
    /// <summary>The part's <c>flightID.ToString()</c>: the id the read side stamps on each <c>parts.robotics</c> entry.</summary>
    [SitrepUnit(Units.Id)]
    public string PartId { get; set; } = "";

    /// <summary>The brake strength as KSP's brake percentage, 0 to 200.</summary>
    [SitrepUnit(Units.Percent)]
    public double Percent { get; set; }
}

/// <summary>
/// Args for <c>robotics.rotor.reverse</c>: flips the rotor's spin direction.
/// It is the one robotics command that is a toggle, reversing whichever way
/// the rotor spins now, so it carries no state field, only the
/// <see cref="PartId"/> to act on.
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
