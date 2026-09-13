// Standing up and withdrawing RP-1's standing targets: a hire instruction, and
// the cancel half of a warp's fund stop-condition.
//
// THE TWO HALVES ARE NOT EQUALLY SAFE, and the difference is where the care went
// rather than a reason to omit one. Cancelling is a Clear() that spends nothing
// and is undone by setting the target again. SETTING a hire target commits the
// career to spending funds it does not yet have, at a moment nobody is watching,
// so the RESERVE is a required argument here: it is the balance hiring will not
// spend below, and it is the operator's number rather than one this file derives
// from settings it cannot see. An instruction that omits it is refused, because
// without one the career buys staff until the money runs out.
//
// (This header said "WHY CANCEL AND NOT SET" until 2026-09-02, describing a file
// that had grown both setters. The reasoning was not wrong, it was answered: the
// reserve is asked for rather than computed.)
//
// THERE IS NO rp1.fundTarget.set, and it is the one setter that was BUILT and
// then removed rather than never written. A fund target is a warp stop-condition
// and nothing else: FundTargetProject returns project type None, its
// IncrementProgress returns zero and it spends no currency, so writing one was
// only ever a way to aim rp1.warp.toFundTarget, which went at the same time.
// RP-1 should not be controlling warp on the app's behalf, and the stop itself
// is a thing the app already owns: a SCET threshold on career.status /
// economy.funds halts the warp inside the simulation on the tick the balance is
// reached. RP-1's client asks for that alarm now. The CANCEL survives because it
// is not the other half of anything: RP-1's own Maintenance screen still stands
// targets up ("Warp to Fund Target" on MaintenanceGUI.RenderSummaryTab), and
// withdrawing one from the dashboard beats going back for the screen that set
// it.
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
    /// <c>rp1.hireTarget.set</c>, and the two cancels
    /// (<c>rp1.hireTarget.cancel</c>, <c>rp1.fundTarget.cancel</c>) that withdraw
    /// a standing instruction without opening the screen that set it.
    /// </summary>
    public sealed class Rp1TargetCommands
    {
        public const string CancelHireCommand = "rp1.hireTarget.cancel";

        public const string CancelFundCommand = "rp1.fundTarget.cancel";

        public const string SetHireCommand = "rp1.hireTarget.set";

        private const string HireProjectTypeName = "RP0.HireStaffProject";

        private const string LaunchComplexTypeName = "RP0.LaunchComplex";

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
        /// Stand up a hire instruction, replicating RP-1's own dialog arms.
        ///
        /// <para>The first arm is the one with words: the target must EXCEED the
        /// current count, and RP-1 says so rather than silently clamping. The
        /// second clamps a too-large target down to the complex's maximum
        /// engineers, which RP-1 does silently, so this does too.</para>
        /// </summary>
        public CommandResult SetHire(Rp1HireTargetSetArgs? args)
        {
            try
            {
                if (args?.TargetCount == null)
                {
                    return CommandResult.Fail(CommandErrorCode.Range, "A target headcount is required.");
                }
                if (args.ReserveFunds == null)
                {
                    return CommandResult.Fail(
                        CommandErrorCode.Range,
                        "A reserve is required: it is the balance hiring will not spend below, and without it the instruction would buy staff until the money ran out.");
                }

                var instance = _scm == null ? null : Rp1Types.StaticValue(_scm, "Instance");
                if (instance == null)
                {
                    return CommandResult.Fail(CommandErrorCode.ModeUnavailable, "RP-1's space centre is not loaded.");
                }

                object? complex = null;
                if (args.LcId != null)
                {
                    complex = FindComplex(instance, args.LcId);
                    if (complex == null)
                    {
                        return CommandResult.Fail(CommandErrorCode.NotFound, "No launch complex with that id.");
                    }
                }

                // The count the target is measured against: a complex's engineers,
                // or the career's researchers when no complex is named. RP-1 makes
                // exactly this choice, and it is also what decides the KIND of
                // staff hired.
                var current = complex != null
                    ? Count(complex, "Engineers")
                    : Count(instance, "Researchers");
                if (current == null)
                {
                    return CommandResult.Fail(CommandErrorCode.Unreadable, "The current staff count could not be read.");
                }

                if (args.TargetCount.Value <= current.Value)
                {
                    return CommandResult.Fail(
                        CommandErrorCode.Range,
                        "Staff count must be greater than the existing amount!");
                }

                // Clamped rather than refused, as RP-1 clamps it: a complex cannot
                // hold more engineers than its size allows.
                var target = args.TargetCount.Value;
                if (complex != null)
                {
                    var max = Count(complex, "MaxEngineers");
                    if (max != null && target > max.Value)
                    {
                        target = max.Value;
                    }
                    if (target < current.Value)
                    {
                        target = current.Value;
                    }
                }

                var type = Rp1Types.Find(HireProjectTypeName);
                var ctor = type == null ? null : Rp1Types.Constructor(type, 4);
                if (ctor == null)
                {
                    return CommandResult.Fail(CommandErrorCode.ModeUnavailable, "RP-1's hire project could not be constructed.");
                }

                var project = ctor.Invoke(new object?[] { current.Value, target, args.ReserveFunds.Value, complex });
                if (!Rp1Types.WriteMember(instance, "staffTarget", project))
                {
                    return CommandResult.Fail(CommandErrorCode.ModeUnavailable, "RP-1's hire target could not be written.");
                }
                return CommandResult.Ok();
            }
            catch (Exception e)
            {
                return CommandResult.Fail(CommandErrorCode.WrongState, "Setting the hire target failed: " + e.Message);
            }
        }

        /// <summary>A headcount as an int, absent when the member is not one.</summary>
        private static int? Count(object? target, string name) =>
            Rp1Types.Member(target, name) is int value ? value : (int?)null;

        /// <summary>The launch complex carrying this id, across every centre.</summary>
        private static object? FindComplex(object spaceCentre, string lcId)
        {
            foreach (var centre in Rp1Types.Enumerate(Rp1Types.Member(spaceCentre, "KSCs")))
            {
                foreach (var lc in Rp1Types.Enumerate(Rp1Types.Member(centre, "LaunchComplexes")))
                {
                    if (string.Equals(Rp1Types.ReadGuidString(lc, "ID"), lcId, StringComparison.OrdinalIgnoreCase))
                    {
                        return lc;
                    }
                }
            }
            return null;
        }

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
                    return CommandResult.Fail(CommandErrorCode.Unreadable, $"RP-1's {what} could not be read.");
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
