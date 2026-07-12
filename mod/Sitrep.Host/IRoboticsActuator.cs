using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// The KSP-actuation seam for the Breaking Ground robotics commands — the
    /// command-side twin of <see cref="PartsViewProvider"/>'s robotics read
    /// channel, and the robotics analogue of <see cref="IVesselActuator"/>.
    /// One method per command, taking already-parsed typed args and returning
    /// an already-typed <see cref="CommandResult"/>.
    /// <see cref="RoboticsCommandProvider"/> (KSP-free, this assembly) does the
    /// arg-parsing / range validation and calls exactly one method here;
    /// <c>Gonogo.KSP.KspRoboticsActuator</c> is the real implementation
    /// (part resolution by <c>flightID</c>, concrete-subtype dispatch, and the
    /// <c>BaseField.SetValue</c> write path that raises the servo's live
    /// <c>OnValueModified</c> callback), while
    /// <c>Sitrep.Host.Tests.FakeRoboticsActuator</c> is the record-and-return
    /// double the provider's unit tests exercise.
    ///
    /// <para>Every method operates on <c>FlightGlobals.ActiveVessel</c> — there
    /// is no per-call vessel selector, matching the read side's "the vessel"
    /// scoping. The <c>partId</c> is the <c>flightID.ToString()</c> the read
    /// side stamps on each <c>parts.robotics</c> entry. A real implementation
    /// returns a typed failure code rather than throwing: no active vessel
    /// (<see cref="CommandErrorCode.NoVessel"/>), no part with that id
    /// (<see cref="CommandErrorCode.NotFound"/>), or a request the resolved
    /// part can't honour — a target aimed at a rotor, a motor command against
    /// a non-motorized servo, or a rotor command against a non-rotor part
    /// (<see cref="CommandErrorCode.ModeUnavailable"/>).</para>
    /// </summary>
    public interface IRoboticsActuator
    {
        CommandResult SetServoTarget(string partId, double value);

        CommandResult SetServoMotor(string partId, bool engaged);

        CommandResult SetServoLock(string partId, bool locked);

        CommandResult SetRotorRpmLimit(string partId, double value);

        CommandResult SetRotorTorqueLimit(string partId, double value);

        CommandResult SetRotorBrake(string partId, double value);

        CommandResult SetRotorMotor(string partId, bool engaged);

        CommandResult SetRotorLock(string partId, bool locked);

        CommandResult ReverseRotor(string partId);
    }
}
