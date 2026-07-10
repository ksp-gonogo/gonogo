#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Args for the servo target commands (<c>robotics.servo.setTarget</c>) —
/// the ABSOLUTE angle (hinge) or extension (piston) to drive to, keyed by
/// the part's <see cref="PartId"/>. <see cref="PartId"/> is the same
/// <c>flightID.ToString()</c> the read side emits on each
/// <c>parts.robotics</c> servo entry, so a widget round-trips the exact id
/// it already displays. A rotor has no target (it spins continuously); a
/// <c>setTarget</c> aimed at one comes back
/// <see cref="CommandResult.ErrorCode"/> <see cref="CommandErrorCode.ModeUnavailable"/>.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class ServoSetTargetArgs
{
    /// <summary>The part's <c>flightID.ToString()</c> — the id the read side stamps on each <c>parts.robotics</c> entry.</summary>
    public string PartId { get; set; } = "";

    /// <summary>Absolute target — hinge angle (degrees) or piston extension.</summary>
    public double Value { get; set; }
}

/// <summary>
/// Args shared by every robotics boolean actuation
/// (<c>robotics.servo.setMotor</c>/<c>setLock</c> and
/// <c>robotics.rotor.setMotor</c>/<c>setLock</c>) — an ABSOLUTE state to
/// apply, never a toggle, matching every other actuation command in this
/// contract (see <see cref="SetEnabledArgs"/>'s doc comment). Keyed by
/// <see cref="PartId"/> (the read side's <c>flightID.ToString()</c>).
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class ServoSetEnabledArgs
{
    /// <summary>The part's <c>flightID.ToString()</c> — the id the read side stamps on each <c>parts.robotics</c> entry.</summary>
    public string PartId { get; set; } = "";

    public bool Enabled { get; set; }
}

/// <summary>
/// Args for the rotor scalar-limit commands
/// (<c>robotics.rotor.setRpmLimit</c>/<c>setTorqueLimit</c>/<c>setBrake</c>)
/// — the ABSOLUTE value to apply, keyed by <see cref="PartId"/>. The bounded
/// ones (torque 0–100, brake 0–200) are range-validated at the send gate;
/// out of range yields <see cref="CommandResult.ErrorCode"/>
/// <see cref="CommandErrorCode.Range"/>.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class RotorSetValueArgs
{
    /// <summary>The part's <c>flightID.ToString()</c> — the id the read side stamps on each <c>parts.robotics</c> entry.</summary>
    public string PartId { get; set; } = "";

    /// <summary>The absolute value to apply (rpm limit, torque-limit percent 0–100, or brake percent 0–200).</summary>
    public double Value { get; set; }
}

/// <summary>
/// Args for <c>robotics.rotor.reverse</c> — flips the rotor's spin direction.
/// This is the one robotics command that is genuinely a toggle (the widget's
/// intent is "spin the other way" relative to whatever the rotor is doing
/// now), so it carries no state field, only the <see cref="PartId"/> to act
/// on.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class RotorReverseArgs
{
    /// <summary>The part's <c>flightID.ToString()</c> — the id the read side stamps on each <c>parts.robotics</c> entry.</summary>
    public string PartId { get; set; } = "";
}
