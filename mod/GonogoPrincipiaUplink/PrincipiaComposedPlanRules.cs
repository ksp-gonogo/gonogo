using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// Whether a plan composed at a command centre may be installed on the craft that
    /// received it.
    ///
    /// <para><b>All of it, or none of it.</b> A plan is checked whole before anything
    /// is written, and one unusable burn refuses the lot. The alternative is a craft
    /// flying a prefix of a plan: burns one and two applied, three rejected, four and
    /// five applied around the gap, producing a trajectory nobody composed and nobody
    /// approved.</para>
    ///
    /// <para><b>Checked against ARRIVAL, not composition.</b> The instant that matters
    /// is when the plan reached the craft, because that is when the ignitions have to
    /// still be ahead. A plan composed while every burn was comfortably in the future
    /// can arrive a light-time later with its first burn already past, and the sender
    /// cannot know that: from a distant vantage, the news that the moment passed is
    /// itself still in transit.</para>
    ///
    /// <para>Principia offers no transaction, so this is validate-then-write rather
    /// than a rollback. The guarantee is that a plan which fails any check writes
    /// NOTHING, not that a failure mid-write can be undone.</para>
    /// </summary>
    public static class PrincipiaComposedPlanRules
    {
        /// <summary>
        /// A plan may hold this many burns. Not a Principia limit: a bound on what a
        /// single command may ask a craft to do, so a malformed or hostile message
        /// cannot drive an unbounded write loop inside the game's update.
        /// </summary>
        public const int MaxBurns = 64;

        /// <summary>
        /// Refuse the whole plan, or null when every burn may be installed.
        ///
        /// <para><paramref name="nowUt"/> is the arrival instant. Passing the
        /// composition instant would check the plan against a moment that has already
        /// gone, which is the failure this rule exists to catch.</para>
        /// </summary>
        public static PrincipiaWriteResult? Reject(
            PrincipiaPlanSendArgs args, double nowUt)
        {
            if (args == null)
            {
                return PrincipiaWriteResult.Refused(
                    PrincipiaWriteRefusal.PlanMalformed,
                    "This command carried no arguments.");
            }

            // Null and empty are different intents and must not be collapsed. An empty
            // list is a plan with no burns, which is a real thing to send; a null list
            // is a message that lost its payload, and installing "no burns" because a
            // field failed to arrive would clear a craft's plan by accident.
            if (args.Burns == null)
            {
                return PrincipiaWriteResult.Refused(
                    PrincipiaWriteRefusal.PlanMalformed,
                    "This plan carried no burn list at all. An empty plan is written as an empty "
                        + "list; a missing list is a command that lost its payload, and the two "
                        + "cannot be told apart after the fact.");
            }

            if (args.Burns.Length > MaxBurns)
            {
                return PrincipiaWriteResult.Refused(
                    PrincipiaWriteRefusal.PlanMalformed,
                    "This plan holds " + args.Burns.Length + " burns, and a single command may "
                        + "install at most " + MaxBurns + ".");
            }

            var previousIgnition = double.NegativeInfinity;
            for (var i = 0; i < args.Burns.Length; i++)
            {
                var burn = args.Burns[i];
                if (burn == null)
                {
                    return PrincipiaWriteResult.Refused(
                        PrincipiaWriteRefusal.PlanMalformed,
                        "Burn " + (i + 1) + " of " + args.Burns.Length + " is missing.");
                }

                if (!IsFinite(burn.IgnitionUt)
                    || !IsFinite(burn.DeltaVTangent)
                    || !IsFinite(burn.DeltaVNormal)
                    || !IsFinite(burn.DeltaVBinormal))
                {
                    return PrincipiaWriteResult.Refused(
                        PrincipiaWriteRefusal.ValueNotFinite,
                        "Burn " + (i + 1) + " of " + args.Burns.Length + " carries a value that is "
                            + "not a number, so the whole plan is refused rather than installed "
                            + "with one burn guessed at.");
                }

                if (burn.IgnitionUt <= nowUt)
                {
                    return PrincipiaWriteResult.Refused(
                        PrincipiaWriteRefusal.IgnitionInPast,
                        "Burn " + (i + 1) + " of " + args.Burns.Length + " ignites at "
                            + burn.IgnitionUt + ", and this plan arrived at " + nowUt
                            + ". The whole plan is refused: installing the burns that are still "
                            + "ahead would fly a plan nobody composed.");
                }

                // Order is part of what was approved. A plan whose burns are not in
                // time order was either composed wrongly or reordered in transit, and
                // installing it would put a manoeuvre before one it depends on.
                if (burn.IgnitionUt <= previousIgnition)
                {
                    return PrincipiaWriteResult.Refused(
                        PrincipiaWriteRefusal.PlanMalformed,
                        "Burn " + (i + 1) + " ignites at " + burn.IgnitionUt
                            + ", at or before burn " + i + " at " + previousIgnition
                            + ". A plan's burns must be in time order.");
                }
                previousIgnition = burn.IgnitionUt;
            }

            if (args.DesiredFinalTimeUt != null)
            {
                if (!IsFinite(args.DesiredFinalTimeUt.Value))
                {
                    return PrincipiaWriteResult.Refused(
                        PrincipiaWriteRefusal.PlanMalformed,
                        "This plan's final time is not a number.");
                }
                if (args.Burns.Length > 0
                    && args.DesiredFinalTimeUt.Value <= args.Burns[args.Burns.Length - 1].IgnitionUt)
                {
                    return PrincipiaWriteResult.Refused(
                        PrincipiaWriteRefusal.PlanMalformed,
                        "This plan ends at " + args.DesiredFinalTimeUt.Value
                            + ", at or before its last burn ignites. The plan would not reach its "
                            + "own last manoeuvre.");
                }
            }

            return null;
        }

        /// <summary>
        /// How stale the plan already was when it arrived: the gap between the state
        /// it was planned against and the instant it landed.
        ///
        /// <para>Reported rather than judged. A large gap is normal at a distant
        /// vantage and is not a fault, but it is what an operator needs in order to
        /// read a divergence between the trajectory they approved and the one the
        /// craft is now on.</para>
        /// </summary>
        public static double? PlanningAgeSeconds(PrincipiaPlanSendArgs args, double nowUt)
        {
            if (args?.ObservedAtUt == null || !IsFinite(args.ObservedAtUt.Value) || !IsFinite(nowUt))
            {
                return null;
            }
            return nowUt - args.ObservedAtUt.Value;
        }

        private static bool IsFinite(double value) =>
            !double.IsNaN(value) && !double.IsInfinity(value);
    }
}
