using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// The KSP-actuation seam for the science-experiment commands — one method
    /// per command, taking an already-resolved <c>partId</c> and returning an
    /// already-typed result, the science-domain twin of
    /// <see cref="IVesselActuator"/>. <see cref="ScienceCommandProvider"/>
    /// (KSP-free, this assembly) does the arg-parsing/result-shaping and the
    /// empty-<c>partId</c> fail-fast; it never touches KSP itself, only this
    /// interface. <c>Gonogo.KSP.KspScienceActuator</c> is the real
    /// implementation (part resolution + <c>ModuleScienceExperiment</c> /
    /// <c>IScienceDataTransmitter</c> calls); a FAKE implementation
    /// (<c>Sitrep.Host.Tests.FakeScienceActuator</c>) is what
    /// <see cref="ScienceCommandProvider"/>'s unit tests exercise instead —
    /// exactly the same KSP-free/real-impl split
    /// <see cref="IVesselActuator"/>/<c>KspVesselActuator</c> already established.
    ///
    /// <para>Both methods operate on <c>FlightGlobals.ActiveVessel</c> — there
    /// is no per-call vessel selector, matching every M1 read channel's "the
    /// vessel" scoping. A real implementation with no active vessel returns
    /// <see cref="CommandErrorCode.NoVessel"/>; an unknown <c>partId</c> (or a
    /// part carrying no experiment module) returns
    /// <see cref="CommandErrorCode.NotFound"/>; an experiment that is not in a
    /// state the command can act on (already deployed/inoperable for deploy; no
    /// stored data or no available transmitter for transmit) returns
    /// <see cref="CommandErrorCode.ModeUnavailable"/> — never a thrown
    /// exception.</para>
    /// </summary>
    public interface IScienceActuator
    {
        CommandResult DeployExperiment(string partId);

        CommandResult TransmitExperiment(string partId);
    }
}
