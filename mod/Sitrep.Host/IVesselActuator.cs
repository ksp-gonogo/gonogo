using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// The KSP-actuation seam for M1 Task 3's typed vessel commands — one
    /// method per command, taking already-parsed typed args and returning an
    /// already-typed result. <see cref="VesselCommandProvider"/> (KSP-free,
    /// this assembly) does the arg-parsing/result-shaping; it never touches
    /// KSP itself, only this interface. <c>Gonogo.KSP.KspVesselActuator</c> is
    /// the real implementation (Vessel.ActionGroups/FlightGlobals/TimeWarp/
    /// the maneuver solver — see its own doc comment); a FAKE implementation
    /// (<c>Sitrep.Host.Tests.FakeVesselActuator</c>) is what
    /// <see cref="VesselCommandProvider"/>'s unit tests exercise instead —
    /// exactly the same KSP-free/real-impl split
    /// <see cref="IKspHost"/>/<c>ReplayKspHost</c> already established for
    /// the read side.
    ///
    /// <para>Every method takes an ALREADY-ACTIVE-vessel assumption (there is
    /// no per-call vessel selector — same scoping as every M1 read channel:
    /// "the vessel" means <c>FlightGlobals.ActiveVessel</c>). A real
    /// implementation with no active vessel returns a failure result
    /// (<see cref="CommandResult.ErrorCode"/> <c>CommandErrorCode.NoVessel</c>) rather than
    /// throwing — <see cref="ChannelEngine"/>'s fail-soft dispatch already
    /// catches a throwing handler, but a routine "nothing to act on right
    /// now" is not the same class of failure as a handler bug, so it gets a
    /// typed result instead of tripping the uplink-wide fail-soft.</para>
    /// </summary>
    public interface IVesselActuator
    {
        CommandResult SetSas(bool enabled);

        CommandResult SetSasMode(SasMode mode);

        CommandResult SetRcs(bool enabled);

        CommandResult SetGear(bool enabled);

        CommandResult SetBrakes(bool enabled);

        CommandResult SetLights(bool enabled);

        CommandResult SetAbort(bool enabled);

        CommandResult SetThrottle(double value);

        /// <summary>
        /// Arms or disarms the persistent fly-by-wire override. Arming attaches
        /// a <c>Vessel.OnFlyByWire</c> callback that writes the held axes into
        /// <c>FlightCtrlState</c> every physics frame; disarming detaches it and
        /// neutralizes the stored axes/trims. See
        /// <c>Gonogo.KSP.KspVesselActuator</c>'s override state machine.
        /// </summary>
        CommandResult SetFlyByWire(bool enabled);

        /// <summary>
        /// Partially updates the held fly-by-wire override — only the non-null
        /// fields of <paramref name="axes"/> overwrite their stored value, so a
        /// single-axis command never clobbers the others.
        /// </summary>
        CommandResult SetControlAxes(SetControlAxesArgs axes);

        CommandResult<int> Stage();

        CommandResult SetActionGroup(int group, bool state);

        CommandResult<string> AddManeuverNode(double ut, double prograde, double normal, double radialOut);

        CommandResult UpdateManeuverNode(string nodeId, double ut, double prograde, double normal, double radialOut);

        CommandResult RemoveManeuverNode(string nodeId);

        /// <summary>
        /// <paramref name="lat"/>/<paramref name="lon"/> are required when
        /// <paramref name="kind"/> is <see cref="TargetKind.Position"/> — a
        /// client-picked surface fix on the CURRENT active-vessel body (see
        /// <see cref="SetTargetArgs.Latitude"/>/<see cref="SetTargetArgs.Longitude"/>),
        /// unused for the <see cref="TargetKind.Vessel"/>/<see cref="TargetKind.Body"/>
        /// cases.
        /// </summary>
        CommandResult SetTarget(TargetKind kind, string? vesselId, int? bodyIndex, double? lat, double? lon);

        CommandResult ClearTarget();

        CommandResult SetWarp(int index);

        CommandResult SetPause(bool paused);
    }
}
