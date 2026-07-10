using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// Which editor a <c>ksp.revertToEditor</c> command targets — the KSP-free
    /// stand-in for KSP's own <c>EditorFacility</c>, so neither
    /// <see cref="FlightOpsCommandProvider"/> nor this assembly ever references
    /// a native KSP type. <see cref="Unknown"/> is the parse-fallback for an
    /// unrecognised wire value (the same <c>Unknown</c>-fallback convention
    /// every other enum in this contract uses); the ordinals of
    /// <see cref="Vab"/>/<see cref="Sph"/> deliberately match KSP's
    /// <c>EditorFacility.VAB</c>/<c>SPH</c> so the real actuator's mapping is a
    /// straight correspondence.
    /// </summary>
    public enum EditorFacilityKind
    {
        Unknown = 0,
        Vab = 1,
        Sph = 2,
    }

    /// <summary>
    /// The KSP-actuation seam for the game-level flight-ops commands
    /// (<c>ksp.*</c>) — one method per command, taking already-parsed typed
    /// args and returning an already-typed <see cref="CommandResult"/>. The
    /// command-side twin of <see cref="IVesselActuator"/> for actions that are
    /// NOT craft actuation but scene/player/game-level operations (revert,
    /// scene load, active-vessel switch, recovery). <see cref="FlightOpsCommandProvider"/>
    /// (KSP-free, this assembly) does the arg-parsing/result-shaping and never
    /// touches KSP; <c>Gonogo.KSP.KspFlightOpsActuator</c> is the real
    /// implementation (<c>FlightDriver</c>/<c>HighLogic</c>/<c>FlightGlobals</c>/
    /// <c>GameEvents</c>), and <c>Sitrep.Host.Tests.FakeFlightOpsActuator</c> is
    /// what the provider's unit tests exercise — the same KSP-free/real-impl
    /// split <see cref="IVesselActuator"/>/<c>KspVesselActuator</c> already
    /// established.
    ///
    /// <para>Each method returns a typed failure (rather than throwing) when its
    /// precondition isn't met — no active vessel
    /// (<see cref="CommandErrorCode.NoVessel"/>), the revert/switch isn't
    /// currently available (<see cref="CommandErrorCode.ModeUnavailable"/>), or
    /// the referenced vessel didn't resolve
    /// (<see cref="CommandErrorCode.NotFound"/>) — matching
    /// <see cref="IVesselActuator"/>'s fail-soft convention.</para>
    /// </summary>
    public interface IFlightOpsActuator
    {
        CommandResult RevertToLaunch();

        CommandResult RevertToEditor(EditorFacilityKind facility);

        CommandResult ToTrackingStation();

        CommandResult SwitchVessel(string vesselId);

        CommandResult Recover();
    }
}
