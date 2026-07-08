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
    /// (<see cref="Ack.ErrorCode"/> <c>"E_NO_VESSEL"</c>) rather than
    /// throwing — <see cref="ChannelEngine"/>'s fail-soft dispatch already
    /// catches a throwing handler, but a routine "nothing to act on right
    /// now" is not the same class of failure as a handler bug, so it gets a
    /// typed result instead of tripping the uplink-wide fail-soft.</para>
    /// </summary>
    public interface IVesselActuator
    {
        Ack SetSas(bool enabled);

        Ack SetSasMode(SasMode mode);

        Ack SetRcs(bool enabled);

        Ack SetGear(bool enabled);

        Ack SetBrakes(bool enabled);

        Ack SetLights(bool enabled);

        Ack SetAbort(bool enabled);

        Ack SetThrottle(double value);

        StageResult Stage();

        Ack SetActionGroup(int group, bool state);

        AddManeuverNodeResult AddManeuverNode(double ut, double prograde, double normal, double radialOut);

        Ack UpdateManeuverNode(string nodeId, double ut, double prograde, double normal, double radialOut);

        Ack RemoveManeuverNode(string nodeId);

        Ack SetTarget(TargetKind kind, string? vesselId, int? bodyIndex);

        Ack ClearTarget();

        Ack SetWarp(int index);

        Ack SetPause(bool paused);
    }
}
