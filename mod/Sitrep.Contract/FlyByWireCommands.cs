#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// <c>vessel.control.setFlyByWire</c>'s args — arm/disarm the persistent
/// fly-by-wire override. FBW is the one <c>vessel.control.*</c> command that is
/// NOT a one-shot actuation: a raw control axis (pitch/yaw/roll/translation) is
/// re-zeroed by KSP every physics frame, so the mod holds an override struct and
/// re-applies it from a <c>Vessel.OnFlyByWire</c> callback while armed. This
/// command flips that armed flag — <see cref="Enabled"/> <c>true</c> attaches the
/// callback (axes resume from their last-set values, or 0 on first arm),
/// <c>false</c> detaches it and neutralizes the stored axes/trims so control is
/// fully handed back to the player/SAS with no residual override.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class SetFlyByWireArgs
{
    public bool Enabled { get; set; }
}

/// <summary>
/// <c>vessel.control.setAxes</c>'s args — a partial update of the held
/// fly-by-wire override. Every field is nullable so the client can drive ONE
/// axis at a time (set-pitch alone) without clobbering the others: only
/// non-null fields overwrite their stored value. Rotation
/// (<see cref="Pitch"/>/<see cref="Yaw"/>/<see cref="Roll"/>) and translation
/// (<see cref="X"/>/<see cref="Y"/>/<see cref="Z"/>) are −1..1; the analog value
/// is preserved end-to-end (a mapped analog stick gives proportional RCS rather
/// than the legacy fork's −1/0/1 quantisation). Trim
/// (<see cref="PitchTrim"/>/<see cref="YawTrim"/>/<see cref="RollTrim"/>) is
/// applied from inside the callback each frame alongside the axes, so it stays
/// durable while armed instead of being stomped by SAS. Out-of-range values are
/// clamped to −1..1 at the admission gate (a hardware stick reading slightly
/// past full is a routine quirk, not an error).
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class SetControlAxesArgs
{
    public double? Pitch { get; set; }

    public double? Yaw { get; set; }

    public double? Roll { get; set; }

    public double? X { get; set; }

    public double? Y { get; set; }

    public double? Z { get; set; }

    public double? PitchTrim { get; set; }

    public double? YawTrim { get; set; }

    public double? RollTrim { get; set; }
}
