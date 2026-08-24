using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// The producer's flight-plan burns, answered as the generalised
    /// <c>vessel.maneuver</c> plan rather than as a producer-shaped payload.
    ///
    /// <para><b>What this makes true.</b> Stock's maneuver model is a subset of
    /// this one: a stock node is an instantaneous burn in the radial/normal/
    /// prograde basis with no engine model, and every field beyond that is absent
    /// on it and present here. So a widget written against
    /// <c>vessel.maneuver</c> renders a Principia plan without knowing Principia
    /// exists, which is the whole of what makes this a Provider rather than a
    /// Domain.</para>
    ///
    /// <para><b>The burn instant is the half-delta-v point, not ignition.</b> A
    /// stock node's <c>Ut</c> is the instant an impulsive burn happens, and the
    /// impulsive equivalent of a finite burn is the instant half its delta-v has
    /// been delivered, which is what the producer's own
    /// <c>TimeToHalfDeltaVSeconds</c> measures from ignition. Reporting ignition
    /// as the instant would make every countdown fire early by half a burn, and
    /// would do it invisibly, because ignition IS an instant and reads as a
    /// plausible one. Ignition and cutoff still travel in their own fields, so
    /// nothing is lost by not putting one of them in this slot.</para>
    ///
    /// <para><b>The ids say where they came from.</b> The producer addresses its
    /// burns by index and has no stable per-burn id to offer, so an id here is
    /// built from that index. It is prefixed rather than published bare so it can
    /// never be mistaken for a stock node's guid: a bare "0" is exactly the
    /// positional id that used to be sent to the stock actuator, which resolves
    /// only an exact guid match and answered NotFound to it every time.</para>
    /// </summary>
    internal sealed class PrincipiaManeuverPlanSource : IManeuverPlanSource
    {
        /// <summary>Marks an id as the producer's rather than the game's.</summary>
        internal const string IdPrefix = "principia:";

        private readonly Func<PlanObservation?> _observation;
        private readonly PlanCommands? _commands;

        internal PrincipiaManeuverPlanSource(
            Func<PlanObservation?> observation, PlanCommands? commands = null)
        {
            _observation = observation ?? throw new ArgumentNullException(nameof(observation));
            _commands = commands;
        }

        public string ProviderId => "principia";

        public IList<Sitrep.Contract.ManeuverNode>? Plan() => Map(_observation());

        /// <summary>
        /// Installs a composed plan through the producer's own whole-plan write.
        ///
        /// <para>Translated rather than reinterpreted. Two things are refused
        /// instead of being quietly dropped, because dropping either changes what
        /// the craft flies while the command still reports success.</para>
        /// </summary>
        public CommandResult SendPlan(SendManeuverPlanArgs plan)
        {
            if (_commands == null)
            {
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "The producer's plan write is not attached, so there is nothing to "
                        + "install this plan into.");
            }

            var translated = Translate(plan, out var refusal);
            if (translated == null)
            {
                return CommandResult.Fail(CommandErrorCode.Range, refusal);
            }

            var result = _commands.SendPlan(translated);
            return result.Success
                ? CommandResult.Ok()
                : CommandResult.Fail(result.ErrorCode, result.Detail);
        }

        /// <summary>
        /// The composed plan in the producer's own shape, or null with a reason.
        ///
        /// <para><b>A basis mismatch is refused, never converted.</b> Turning a
        /// radial/normal/prograde burn into a Frenet one needs the trajectory the
        /// burn sits on, which this side does not have. Passing the three numbers
        /// through unchanged would fly a different burn, and it would look
        /// completely ordinary doing it.</para>
        ///
        /// <para><b>A stated engine is refused too.</b> The producer's whole-plan
        /// write carries an engine PRESET rather than a thrust and a specific
        /// impulse, so numbers stated here have nowhere to go. Silently leaving
        /// the plan's existing engine would fly the composed burn with the wrong
        /// one.</para>
        /// </summary>
        internal static PrincipiaPlanSendArgs? Translate(
            SendManeuverPlanArgs plan, out string? refusal)
        {
            refusal = null;
            var burns = new List<PrincipiaComposedBurn>();
            foreach (var burn in plan.Burns!)
            {
                if (burn.Frame != ManeuverFrame.TangentNormalBinormal)
                {
                    refusal =
                        "This planner works in the Frenet trihedron, and the plan states its "
                        + "burns in another basis. Converting one to the other needs the "
                        + "trajectory the burn sits on, so the same three numbers would fly a "
                        + "different burn.";
                    return null;
                }
                if (burn.Thrust != null || burn.SpecificImpulse != null)
                {
                    refusal =
                        "This planner's whole-plan write carries an engine preset rather than a "
                        + "thrust and a specific impulse, so the stated engine has nowhere to "
                        + "go. Set the engine on the burn in the planner, then send the plan.";
                    return null;
                }

                burns.Add(new PrincipiaComposedBurn
                {
                    IgnitionUt = burn.IgnitionUt,
                    // Slot order, not a rename: the three positional slots carry
                    // the basis's own components in its own order, and this basis
                    // is tangent, normal, binormal.
                    DeltaVTangent = burn.DvRadial,
                    DeltaVNormal = burn.DvNormal,
                    DeltaVBinormal = burn.DvPrograde,
                    InertiallyFixed = burn.InertiallyFixed,
                    Profile = PrincipiaBurnProfile.Unchanged,
                });
            }

            return new PrincipiaPlanSendArgs
            {
                VesselId = plan.VesselId,
                RequestId = plan.RequestId,
                ComposedAtViewUt = plan.ComposedAtViewUt,
                ObservedAtUt = plan.ObservedAtUt,
                DesiredFinalTimeUt = plan.DesiredFinalTimeUt,
                Burns = burns.ToArray(),
            };
        }

        /// <summary>
        /// The observed plan as generalised nodes.
        ///
        /// <para>Null ONLY when nothing has been observed. A craft that was read
        /// and holds no flight plan answers with an EMPTY list, because this
        /// planner can make one for it and simply has not: null on that seam is
        /// reserved for "this craft cannot hold a plan at all", which is how an
        /// un-upgraded Tracking Station reaches a client, and it is what decides
        /// whether the wire names a planner beside the nodes. Collapsing the two
        /// leaves a client unable to tell an install with an n-body planner from
        /// one with none.</para>
        /// </summary>
        internal static IList<Sitrep.Contract.ManeuverNode>? Map(PlanObservation? plan)
        {
            if (plan == null)
            {
                return null;
            }

            var nodes = new List<Sitrep.Contract.ManeuverNode>();
            if (!plan.PlanExists)
            {
                return nodes;
            }

            foreach (var burn in plan.Burns)
            {
                var node = MapBurn(burn);
                if (node != null)
                {
                    nodes.Add(node);
                }
            }
            return nodes;
        }

        /// <summary>
        /// One burn as a node, or null when it has no readable instant.
        ///
        /// <para>A node's instant is not optional, and a burn whose ignition time
        /// could not be read is a burn we failed to read rather than one that
        /// happens at no particular time. The choice is between omitting it and
        /// publishing it at UT zero, and zero renders as a burn in the deep past:
        /// an operator would see a manoeuvre that is not there, at a time it is
        /// not at, rather than a plan one short.</para>
        /// </summary>
        internal static Sitrep.Contract.ManeuverNode? MapBurn(PlannedBurnObservation burn)
        {
            var instant = ImpulsiveInstant(burn);
            if (instant == null)
            {
                return null;
            }

            return new Sitrep.Contract.ManeuverNode
            {
                Id = IdPrefix + burn.Index.ToString(),
                Ut = instant.Value,
                IgnitionUt = burn.IgnitionUt,
                CutoffUt = burn.CutoffUt,
                // The producer works in the Frenet trihedron, so the three
                // positional slots carry tangent, normal and binormal in that
                // order. See ManeuverNode.Frame: the slots are the basis's own
                // components in its own order, and the field names are the stock
                // basis's, which is exactly why Frame has to travel with them.
                Frame = ManeuverFrame.TangentNormalBinormal,
                DvRadial = burn.DeltaVTangent,
                DvNormal = burn.DeltaVNormal,
                DvPrograde = burn.DeltaVBinormal,
                DvTotal = TotalOf(burn),
                InertiallyFixed = burn.InertiallyFixed,
                Thrust = burn.ThrustKilonewtons,
                SpecificImpulse = burn.SpecificImpulseSeconds,
                InitialMass = burn.InitialMassTons,
                FinalMass = burn.FinalMassTons,
                // Deliberately empty rather than absent. The producer renders a
                // plan's segments through calls this Uplink refuses by name for
                // aborting the process on the player's own UI state, so there is
                // no post-burn patch chain to offer. An empty chain is what a
                // reader is already told to expect from a planner that integrates
                // rather than one that patches conics.
                Patches = new List<OrbitPatch>(),
            };
        }

        /// <summary>
        /// The instant an equivalent impulsive burn would happen: ignition plus
        /// the offset to half the delta-v.
        ///
        /// <para>Falls back to ignition when the producer could not offer the
        /// offset, which is the closest true instant available rather than a
        /// guess, and is stated here so a reader comparing two plans knows the two
        /// numbers can mean slightly different things.</para>
        /// </summary>
        internal static double? ImpulsiveInstant(PlannedBurnObservation burn)
        {
            if (burn.IgnitionUt == null)
            {
                return null;
            }
            if (burn.TimeToHalfDeltaVSeconds == null)
            {
                return burn.IgnitionUt;
            }
            return burn.IgnitionUt + burn.TimeToHalfDeltaVSeconds;
        }

        /// <summary>
        /// The burn's magnitude, from the three components the producer gave.
        ///
        /// <para>Null when any component is missing rather than summed from what
        /// arrived: a total built from two of three axes is smaller than the real
        /// burn and reads as a perfectly ordinary number.</para>
        /// </summary>
        internal static double? TotalOf(PlannedBurnObservation burn)
        {
            if (burn.DeltaVTangent == null
                || burn.DeltaVNormal == null
                || burn.DeltaVBinormal == null)
            {
                return null;
            }

            var t = burn.DeltaVTangent.Value;
            var n = burn.DeltaVNormal.Value;
            var b = burn.DeltaVBinormal.Value;
            return Math.Sqrt((t * t) + (n * n) + (b * b));
        }
    }
}
