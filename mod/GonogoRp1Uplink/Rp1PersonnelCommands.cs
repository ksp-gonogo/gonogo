// RP-1's staffing write surface: move engineers between a centre's unassigned
// pool and one of its launch complexes.
//
// WHAT WAS WRONG WITHOUT IT. Assignment is the fact the whole space-centre view
// exists to make visible: RP-1 advances a complex's work at
// Engineers / MaxEngineers, so a complex with nobody assigned builds NOTHING
// however many engineers the career has hired, and an engineer assigned to
// nothing draws salary for no work. An operator could read both of those from
// this Uplink and then had to go into the game to act on either.
//
// WHAT THIS DELIBERATELY IS NOT. It does not hire and it does not fire. Hiring
// spends funds, raises the standing payroll and goes through
// KCTUtilities.HireStaff, which bills HireCost per applicant short and moves
// both the centre pool and the complex at once. That is a purchase and belongs
// with the other spend controls, behind an arm-then-confirm and beside a
// balance. Assignment spends nothing at the moment it lands: the engineers are
// already on the books, and all that changes is which complex they work at.
// Keeping the two apart is what lets this command be a single press.
//
// THE MEMBERS IT TOUCHES, each read off the shipped RP-1 v4.6.0.0 RP0.dll:
//
//   LaunchComplex.Engineers        a plain [Persistent] public int, RP-1's own
//                                  window assigns straight into it
//   LaunchComplex.MaxEngineers     pure arithmetic over the complex's mass and
//                                  size envelope; the ceiling a complex can hold
//   LaunchComplex.IsOperational    false for the whole of a construction or
//                                  modification
//   LaunchComplex.KSC              the owning centre, a plain backing field
//   LCSpaceCenter.UnassignedEngineers
//                                  DERIVED: the centre's hired count minus the
//                                  sum of its complexes' assigned counts, so it
//                                  is what the pool has left rather than a
//                                  stored figure
//   KCTUtilities.ChangeEngineers(LaunchComplex, int)
//                                  the write, via Rp1ComplexWrites for the
//                                  overload hazard
//
// THE CLAMP IS OURS TO DO. ChangeEngineers adds the delta and clamps nothing:
// RP-1's own window works the legal move out first, as
// Math.Min(KSC.UnassignedEngineers, MaxEngineers - Engineers) going up and the
// complex's own count going down. This file asks the same two questions and
// REFUSES rather than clamping, because a clamp reports success for a crew size
// the operator did not ask for.
//
// A NON-OPERATIONAL COMPLEX IS REFUSED, and that is a decision rather than a
// limitation. RP-1 takes a complex's crew off when construction or modification
// starts, records how many it took as engineersToReadd, and puts them back
// itself on completion with ChangeEngineers(lc, min(readd, max, unassigned)).
// That re-add ADDS, so a crew assigned while the work was in flight is still
// there when it lands and the complex can finish above its own maximum. The safe
// direction of a state we would be racing is not to write.
using System;
using System.Globalization;
using System.Reflection;
using Sitrep.Contract;

namespace GonogoRp1Uplink
{
    /// <summary>The handler for <c>rp1.personnel.assign</c>.</summary>
    public sealed class Rp1PersonnelCommands
    {
        /// <summary>Set how many engineers a launch complex has assigned to it.</summary>
        public const string AssignCommand = "rp1.personnel.assign";

        private const string ScmTypeName = "RP0.SpaceCenterManagement";
        private const string UtilitiesTypeName = "RP0.KCTUtilities";

        private readonly Type? _scm;
        private readonly Type? _utilities;

        public Rp1PersonnelCommands()
        {
            _scm = Rp1Types.Find(ScmTypeName);
            _utilities = Rp1Types.Find(UtilitiesTypeName);
        }

        /// <summary>
        /// The command can run: RP-1's space centre and its static helpers
        /// resolved.
        ///
        /// <para>TYPES ONLY, for the reason
        /// <see cref="Rp1VehicleCommands.IsAvailable"/> spells out at length: a
        /// method-level gate on the MANIFEST cannot say why it fired, because a
        /// command that was never declared looks exactly like one nobody wrote.
        /// The method lookup happens at the press and refuses with a sentence
        /// naming what was not recognised.</para>
        /// </summary>
        public bool IsAvailable => _scm != null && _utilities != null;

        /// <summary>
        /// Whether the one member this command invokes resolved, as a sentence for
        /// a health fact. The same reasoning as
        /// <see cref="Rp1VehicleCommands.MethodDiagnosis"/>: a withheld command
        /// and an absent one are indistinguishable from outside, and naming the
        /// member is the difference between "nobody wrote this" and "RP-1 renamed
        /// ChangeEngineers".
        /// </summary>
        public string MethodDiagnosis()
        {
            if (_scm == null || _utilities == null)
            {
                return "RP-1 space-centre types not found";
            }
            try
            {
                return Rp1ComplexWrites.ChangeEngineers(_utilities) == null
                    ? "assignment will refuse at the press: KCTUtilities.ChangeEngineers(LaunchComplex, int) not found"
                    : "every invoked member resolved";
            }
            catch (Exception ex)
            {
                // Runs from Health, on the Courier thread. A diagnostic that takes
                // the health surface down with it is worse than no diagnostic.
                return "assignment will refuse at the press: KCTUtilities.ChangeEngineers threw on lookup: "
                    + Rp1Types.ExceptionReason(ex);
            }
        }

        /// <summary>
        /// Sets a launch complex's assigned engineer count.
        ///
        /// <para>A SET, so re-sending it is harmless and it lands on the count
        /// that was asked for however stale the operator's view was. A target
        /// already met changes nothing and succeeds: the asked-for state is the
        /// state.</para>
        /// </summary>
        public CommandResult Assign(Rp1PersonnelAssignArgs? args)
        {
            var lcId = args?.LcId;
            if (string.IsNullOrWhiteSpace(lcId))
            {
                return CommandResult.Fail(
                    CommandErrorCode.NotFound,
                    "the command named no launch complex");
            }

            var target = args?.Engineers;
            if (target == null)
            {
                // Refused rather than defaulted. Neither zero nor the complex's
                // maximum is a guess worth making about a crew.
                return CommandResult.Fail(
                    CommandErrorCode.Range,
                    "the command did not say how many engineers to leave at the complex");
            }

            if (target.Value < 0)
            {
                return CommandResult.Fail(
                    CommandErrorCode.Range,
                    "a launch complex cannot have fewer than no engineers");
            }

            if (!IsAvailable)
            {
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1's space-centre model could not be resolved, so nothing was changed");
            }

            var scm = Rp1Types.StaticValue(_scm!, "Instance");
            if (scm == null)
            {
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1's space centre is not loaded");
            }

            if (Rp1Types.ReadBool(scm, "enabledForSave") != true)
            {
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 is not managing this save");
            }

            if (!Rp1ComplexWrites.TryFind(scm, lcId!, out var complex))
            {
                return CommandResult.Fail(
                    CommandErrorCode.NotFound,
                    "no launch complex with that id exists at any space centre");
            }

            var name = Rp1Types.ReadString(complex, "Name") ?? "the launch complex";

            if (Rp1Types.ReadBool(complex, "IsOperational") != true)
            {
                // See this file's header: RP-1 holds this complex's crew itself
                // until the work finishes and then puts them back by ADDING, so a
                // crew assigned now would still be there when the re-add lands.
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    name + " is being built or modified, and RP-1 puts its crew back itself when that finishes");
            }

            var current = ReadCount(complex, "Engineers");
            var max = ReadCount(complex, "MaxEngineers");
            if (current == null || max == null)
            {
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 would not say how many engineers " + name + " has or can hold");
            }

            if (target.Value > max.Value)
            {
                return CommandResult.Fail(
                    CommandErrorCode.Range,
                    name + " holds at most " + Number(max.Value) + " engineers, and the command asked for "
                    + Number(target.Value));
            }

            var delta = target.Value - current.Value;
            if (delta == 0)
            {
                return CommandResult.Ok();
            }

            if (delta > 0)
            {
                var centre = Rp1Types.Member(complex, "KSC");
                var unassigned = ReadCount(centre, "UnassignedEngineers");
                if (unassigned == null)
                {
                    return CommandResult.Fail(
                        CommandErrorCode.ModeUnavailable,
                        "RP-1 would not say how many engineers are unassigned at " + CentreName(centre));
                }
                if (delta > unassigned.Value)
                {
                    return CommandResult.Fail(
                        CommandErrorCode.Range,
                        "that would take " + Number(delta) + " engineers off the pool at "
                        + CentreName(centre) + ", which has " + Number(unassigned.Value)
                        + " unassigned. Hiring is a separate act and this command does not do it");
                }
            }

            MethodInfo? changeEngineers;
            try
            {
                changeEngineers = Rp1ComplexWrites.ChangeEngineers(_utilities);
            }
            catch (Exception ex)
            {
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "this RP-1 build's engineer assignment could not be resolved: " + Rp1Types.ExceptionReason(ex));
            }

            if (changeEngineers == null)
            {
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "this RP-1 build has no engineer assignment this Uplink recognises, so nothing was changed");
            }

            try
            {
                changeEngineers.Invoke(null, new object[] { complex, delta });
            }
            catch (Exception ex)
            {
                // The write and the recalculation are one RP-1 call, so a throw
                // here leaves a state this Uplink cannot narrow: the count may
                // have moved before the events fired. Said rather than reported as
                // a plain refusal, because an operator who reads "refused" would
                // expect the crew not to have moved.
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 failed part-way through moving " + name + "'s crew, so check the complex: "
                    + Rp1Types.ExceptionReason(ex));
            }

            return CommandResult.Ok();
        }

        /// <summary>
        /// A count RP-1 keeps as an int, whether as a field or as a derived
        /// property. Absent rather than zero when it could not be read: zero is a
        /// legitimate crew and a legitimate empty pool, and treating an unreadable
        /// member as either would let this command write against a number nobody
        /// answered with.
        /// </summary>
        private static int? ReadCount(object? target, string name)
        {
            switch (Rp1Types.Member(target, name))
            {
                case int i: return i;
                case long l: return (int)l;
                case short s: return s;
                default: return null;
            }
        }

        /// <summary>The centre's name for a refusal sentence, or a phrase that reads as one.</summary>
        private static string CentreName(object? centre) =>
            Rp1Types.ReadString(centre, "KSCName") ?? "that space centre";

        /// <summary>Grouped, because these are read by a person: 1,200 rather than 1200.</summary>
        private static string Number(int value) =>
            value.ToString("N0", CultureInfo.InvariantCulture);
    }
}
