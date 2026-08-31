// Cancelling the two standing targets: a hire instruction and a warp's fund
// stop-condition.
//
// WHY CANCEL AND NOT SET. Both are read-and-cancel rather than read-and-write,
// because the two halves are not equally safe. Cancelling is a Clear() that
// spends nothing and can be undone by setting the target again; SETTING a hire
// target commits the career to spending funds it does not yet have, at a moment
// nobody is watching, and RP-1 computes the reserve it must keep back from
// settings this file does not read. A command that got that reserve wrong would
// hire into a hole.
//
// WHAT MAKES CANCELLING SAFE. Both Clear() implementations are pure field
// resets, read on the shipped RP-1 v4.6.0.0 RP0.dll:
//
//   HireStaffProject.Clear()  zeroes the three persisted fields and drops the
//                             complex reference. It touches no currency.
//   FundTargetProject.Clear() zeroes both figures and restores the auto-warp
//                             epsilon. It touches no currency.
//
// Neither raises an event, so nothing else in RP-1 needs to hear about it, and
// neither can fail part-way and leave the career in a state between two.
//
// THE ONE THING TO BE CAREFUL OF. A cancel against a target that is not standing
// must not report success, because the operator's next question is "did I just
// cancel something?" and the honest answer when nothing was running is no. So
// validity is asked first and a cancel with nothing to cancel refuses, rather
// than clearing an already-clear project and reporting a change that never
// happened.
using System;
using Sitrep.Contract;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// <c>rp1.hireTarget.cancel</c> and <c>rp1.fundTarget.cancel</c>: withdraw a
    /// standing instruction without opening the screen that set it.
    /// </summary>
    public sealed class Rp1TargetCommands
    {
        public const string CancelHireCommand = "rp1.hireTarget.cancel";

        public const string CancelFundCommand = "rp1.fundTarget.cancel";

        private const string ScmTypeName = "RP0.SpaceCenterManagement";

        private readonly Type? _scm;

        public Rp1TargetCommands() => _scm = Rp1Types.Find(ScmTypeName);

        /// <summary>RP-1's space centre type resolved, so the commands can be offered at all.</summary>
        public bool IsAvailable => _scm != null;

        /// <summary>Withdraw the standing hire instruction.</summary>
        public CommandResult CancelHire(Rp1TargetCancelArgs? args) =>
            Cancel("staffTarget", "hire target");

        /// <summary>Withdraw the warp's fund stop-condition.</summary>
        public CommandResult CancelFund(Rp1TargetCancelArgs? args) =>
            Cancel("fundTarget", "fund target");

        /// <summary>
        /// The shared procedure, which is the same for both because both targets
        /// are the same shape: ask whether one stands, then clear it.
        /// </summary>
        private CommandResult Cancel(string field, string what)
        {
            try
            {
                var instance = _scm == null ? null : Rp1Types.StaticValue(_scm, "Instance");
                if (instance == null)
                {
                    return CommandResult.Fail(CommandErrorCode.ModeUnavailable, $"RP-1's space centre is not loaded, so there is no {what} to cancel.");
                }

                var project = Rp1Types.Member(instance, field);
                if (project == null)
                {
                    return CommandResult.Fail(CommandErrorCode.ModeUnavailable, $"RP-1's {what} could not be read.");
                }

                // Asked before clearing, so a cancel with nothing to cancel says
                // so rather than reporting a change that did not happen.
                if (Rp1Types.ReadBool(project, "IsValid") != true)
                {
                    return CommandResult.Fail(CommandErrorCode.WrongState, $"No {what} is set.");
                }

                var clear = Rp1Types.InstanceMethod(project, "Clear", 0);
                if (clear == null)
                {
                    return CommandResult.Fail(CommandErrorCode.ModeUnavailable, $"RP-1's {what} does not expose a cancel.");
                }

                clear.Invoke(project, null);
                return CommandResult.Ok();
            }
            catch (Exception e)
            {
                return CommandResult.Fail(CommandErrorCode.WrongState, $"Cancelling the {what} failed: {e.Message}");
            }
        }
    }
}
