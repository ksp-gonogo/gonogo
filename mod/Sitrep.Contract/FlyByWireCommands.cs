#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// <c>vessel.control.setFlyByWire</c>'s args: turn the fly-by-wire override on
/// or off. Unlike the other <c>vessel.control.*</c> commands this is not a
/// one-shot actuation: KSP resets the raw control axes every physics frame, so
/// while the override is on the mod re-applies the held axes and trims (set
/// with <c>vessel.control.setAxes</c>) every frame.
///
/// <para>Turning it on resumes the held values (0 until an axis has been set).
/// Turning it off stops the override and resets every held axis and trim to 0,
/// so control returns to the player and SAS with nothing left over. Turning it
/// on fails when there is no active vessel or the vessel cannot currently be
/// controlled; turning it off is never refused for control reasons.</para>
/// <internal>
/// The override is re-applied from a Vessel.OnFlyByWire callback held by
/// KspVesselActuator.
/// </internal>
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("vessel.control.setFlyByWire")]
public class SetFlyByWireArgs
{
    /// <summary><c>true</c> turns the override on, <c>false</c> turns it off and resets the held axes and trims to 0.</summary>
    [SitrepUnit(Units.Flag)]
    public bool Enabled { get; set; }
}

/// <summary>
/// <c>vessel.control.setAxes</c>'s args: a partial update of the held
/// fly-by-wire override. Every field is nullable, and only the fields you set
/// change their held value, so one axis can be driven on its own without
/// disturbing the others.
///
/// <para>Every value is -1..1 and analog: a value between the ends gives a
/// proportional input (for example proportional RCS from a mapped analog
/// stick). A value outside -1..1 is clamped rather than refused. The trims are
/// re-applied every frame alongside the axes while the override is on, so SAS
/// does not overwrite them.</para>
///
/// <para>Held values only act on the vessel while the override is on (see
/// <c>vessel.control.setFlyByWire</c>); values set while it is off are held
/// and take effect when it is turned on. The command fails when there is no
/// active vessel or the vessel cannot currently be controlled. The applied
/// axes read back on <c>vessel.control</c>.</para>
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("vessel.control.setAxes")]
public class SetControlAxesArgs
{
    /// <summary>Pitch input, -1..1. Null leaves the held value unchanged.</summary>
    [SitrepUnit(Units.Dimensionless)]
    public double? Pitch { get; set; }

    /// <summary>Yaw input, -1..1. Null leaves the held value unchanged.</summary>
    [SitrepUnit(Units.Dimensionless)]
    public double? Yaw { get; set; }

    /// <summary>Roll input, -1..1. Null leaves the held value unchanged.</summary>
    [SitrepUnit(Units.Dimensionless)]
    public double? Roll { get; set; }

    /// <summary>Translation X input (RCS right/left), -1..1. Null leaves the held value unchanged.</summary>
    [SitrepUnit(Units.Dimensionless)]
    public double? X { get; set; }

    /// <summary>Translation Y input (RCS up/down), -1..1. Null leaves the held value unchanged.</summary>
    [SitrepUnit(Units.Dimensionless)]
    public double? Y { get; set; }

    /// <summary>Translation Z input (RCS forward/back), -1..1. Null leaves the held value unchanged.</summary>
    [SitrepUnit(Units.Dimensionless)]
    public double? Z { get; set; }

    /// <summary>Pitch trim, -1..1. Null leaves the held value unchanged.</summary>
    [SitrepUnit(Units.Dimensionless)]
    public double? PitchTrim { get; set; }

    /// <summary>Yaw trim, -1..1. Null leaves the held value unchanged.</summary>
    [SitrepUnit(Units.Dimensionless)]
    public double? YawTrim { get; set; }

    /// <summary>Roll trim, -1..1. Null leaves the held value unchanged.</summary>
    [SitrepUnit(Units.Dimensionless)]
    public double? RollTrim { get; set; }
}
