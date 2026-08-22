using System;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// What a burn must satisfy before it is handed back to the plugin, and how an
    /// operator's edit is applied to one that came out of it.
    ///
    /// <para>Pure and game-free: everything here works on any object carrying the
    /// producer's field names, so the rules are exercisable against a stand-in.
    /// That matters more here than anywhere else in this Uplink, because two of
    /// these checks stand between a console control and the KSP process
    /// ending.</para>
    /// </summary>
    public static class PrincipiaBurnRules
    {
        /// <summary>
        /// Principia's own instant-impulse preset. Thrust in kilonewtons equal to
        /// a thousand times the mass in tonnes, which is an acceleration of a
        /// thousand metres per second squared, with a specific impulse of a thousand
        /// seconds.
        ///
        /// <para>The numbers are the producer's, taken from the installed build
        /// rather than invented, because the point of the control is to see what
        /// Principia would draw and a different pair of numbers would draw a
        /// different arc.</para>
        /// </summary>
        public const double InstantImpulseThrustPerTonne = 1000.0;
        public const double InstantImpulseSpecificImpulseSeconds = 1000.0;

        private static readonly PrincipiaBurnStruct Fields = new PrincipiaBurnStruct();

        /// <summary>
        /// Why this burn must not be sent to the plugin, or null when it may be.
        ///
        /// <para>Checked immediately before the call rather than when the edit was
        /// composed, so a burn that arrived from the plugin already carrying a frame
        /// we refuse is refused even if nothing we did touched the frame.</para>
        /// </summary>
        public static PrincipiaWriteResult? Reject(object burn)
        {
            var missing = Fields.MissingBurnField(burn);
            if (missing != null)
            {
                return PrincipiaWriteResult.Refused(
                    PrincipiaWriteRefusal.PluginShapeChanged,
                    "Principia's burn struct has no '" + missing + "' field, so it is not the "
                    + "shape this Uplink was audited against. Nothing will be written: a burn with "
                    + "a field missing does not fail to marshal, it writes a plausible wrong burn "
                    + "into the save.");
            }

            var extension = Fields.FrameExtension(burn);
            if (extension == null || !PrincipiaBurnStruct.IsEditableFrame(extension.Value))
            {
                return PrincipiaWriteResult.Refused(
                    PrincipiaWriteRefusal.BurnFrameUnsupported,
                    "This burn's maneuvering frame (kind " + (extension?.ToString() ?? "unknown")
                    + ") is not one Principia's own frame factory handles when a burn is written "
                    + "back. One such kind is a fatal log inside the plugin, which ends the KSP "
                    + "process; the guard that keeps Principia's own editor away from it is a cast "
                    + "operator that quietly answers null, and a cast operator is not something a "
                    + "caller can see. Change the burn's frame in-game, or edit a different burn.");
            }

            var thrust = Fields.GetDouble(burn, PrincipiaBurnStruct.ThrustField);
            if (thrust == null || thrust.Value <= 0)
            {
                return PrincipiaWriteResult.Refused(
                    PrincipiaWriteRefusal.ThrustNotPositive,
                    "A planned burn needs positive thrust. At zero the burn's duration is "
                    + "infinite, which Principia's own singularity test does not catch because it "
                    + "tests the Dv: the plan's end instant becomes infinite, a thread is spawned "
                    + "that never terminates, and the infinity is written into the save.");
            }

            var isp = Fields.GetDouble(burn, PrincipiaBurnStruct.SpecificImpulseField);
            if (isp == null || isp.Value <= 0)
            {
                return PrincipiaWriteResult.Refused(
                    PrincipiaWriteRefusal.ThrustNotPositive,
                    "A planned burn needs a positive specific impulse; at zero its duration is "
                    + "not a number.");
            }

            var ignition = Fields.GetDouble(burn, PrincipiaBurnStruct.InitialTimeField);
            if (ignition == null)
            {
                return PrincipiaWriteResult.Refused(
                    PrincipiaWriteRefusal.ValueNotFinite,
                    "This burn's ignition instant is not a finite number.");
            }

            var deltaV = Fields.DeltaV(burn);
            if (deltaV == null
                || !IsFinite(deltaV.Value.X) || !IsFinite(deltaV.Value.Y) || !IsFinite(deltaV.Value.Z))
            {
                return PrincipiaWriteResult.Refused(
                    PrincipiaWriteRefusal.ValueNotFinite,
                    "This burn's Dv is not a finite triple. Principia reports that as a singular "
                    + "maneuver rather than aborting, but there is no reason to ask.");
            }

            return null;
        }

        /// <summary>
        /// Why a burn that is running right now must not be edited, or null.
        ///
        /// <para><b>This guard is entirely ours.</b> Principia's fit test never looks
        /// at the current time, and only its rebase entry point refuses during a
        /// maneuver; the burn editor merely notes that every maneuver is in the past.
        /// So inserting, replacing or removing a burn mid-ignition is permitted by
        /// the plugin, and the vessel is under thrust while its plan changes
        /// underneath it.</para>
        ///
        /// <para>A burn wholly in the PAST is allowed. It cannot be re-flown and
        /// editing it is how an operator tidies a plan; the producer's own window
        /// allows it too, with a warning.</para>
        /// </summary>
        public static PrincipiaWriteResult? RejectExecuting(
            double? ignitionUt, double? cutoffUt, double nowUt)
        {
            if (ignitionUt == null || cutoffUt == null)
            {
                return null;
            }
            if (nowUt < ignitionUt.Value || nowUt > cutoffUt.Value)
            {
                return null;
            }
            return PrincipiaWriteResult.Refused(
                PrincipiaWriteRefusal.BurnExecuting,
                "This burn is running: it ignited and has not cut off. Principia permits the edit "
                + "and will not warn, so the refusal is the console's. Wait for cutoff, or edit "
                + "another burn.");
        }

        /// <summary>
        /// Why an ignition instant this write ASKED FOR must not be written, or null.
        ///
        /// <para><b>The requested instant, tested against the instant the write
        /// arrived at.</b> Every other check in this file is about the burn as the
        /// plugin handed it over; this one is about what the operator asked for, and
        /// it is the only one that can catch a request that was correct when it was
        /// composed. Under signal delay the plan on the operator's screen left the
        /// game one light time ago and the edit spends another getting back, so at a
        /// thirty-light-minute vantage an instant an hour ahead on screen arrives
        /// already spent, with nothing done wrong at either end.</para>
        ///
        /// <para><b>Nothing else in the chain tests it.</b> The finiteness check does
        /// not look at a clock. <see cref="RejectExecuting"/> tests the burn's
        /// CURRENT ignition, and correctly permits one wholly in the past, because
        /// its question is whether the craft is under thrust. A declared precondition
        /// runs at dispatch, before the courier is involved, which is the wrong end
        /// of the delay entirely: the only place the arrival instant exists is
        /// here.</para>
        ///
        /// <para><b>What is not established.</b> What the plugin actually DOES with a
        /// manoeuvre whose ignition is behind the current time but still inside the
        /// plan's own interval was not determined: it may integrate it, refuse it, or
        /// produce an arc from a state the craft was never in. So this refusal is not
        /// justified by a consequence anyone has observed. It is justified by what
        /// the write MEANS: a burn asked to start at an instant that has gone is a
        /// manoeuvre the craft did not fly, so the plan it produces is a
        /// counterfactual whatever the integrator makes of it, and a receipt reading
        /// Written for one is the misreport worth refusing.</para>
        ///
        /// <para>A request that states no instant is not tested. That is what keeps
        /// tidying a flown burn's delta-v possible, which the producer's own window
        /// allows too.</para>
        /// </summary>
        public static PrincipiaWriteResult? RejectRequestedIgnition(
            double? requestedIgnitionUt, double nowUt)
        {
            if (requestedIgnitionUt == null || !IsFinite(requestedIgnitionUt.Value))
            {
                return null;
            }
            if (requestedIgnitionUt.Value > nowUt)
            {
                return null;
            }
            return PrincipiaWriteResult.Refused(
                PrincipiaWriteRefusal.IgnitionInPast,
                "This edit asked for an ignition at " + requestedIgnitionUt.Value
                + ", and it is now " + nowUt + ", so the instant had passed before the edit "
                + "arrived. Under signal delay that happens to an edit that was correct when "
                + "it was sent: the plan it was composed against is one light time old and the "
                + "edit is another light time behind that. Nothing has been written, because a "
                + "burn starting at an instant that has gone is a manoeuvre this craft did not "
                + "fly. Send the burn at a later instant.");
        }

        /// <summary>
        /// Applies an operator's edit to a burn that came OUT of the plugin,
        /// returning the refusal when it cannot.
        ///
        /// <para>Every omitted field on the request leaves the plugin's own value
        /// alone, which is what makes this a round trip rather than a composition.
        /// The burn object is mutated in place and is the one handed back.</para>
        /// </summary>
        public static PrincipiaWriteResult? Apply(
            object burn, PrincipiaBurnEditArgs edit, double? initialMassTons)
        {
            var missing = Fields.MissingBurnField(burn);
            if (missing != null)
            {
                return PrincipiaWriteResult.Refused(
                    PrincipiaWriteRefusal.PluginShapeChanged,
                    "Principia's burn struct has no '" + missing + "' field, so this edit cannot "
                    + "be applied to it without guessing.");
            }

            if (edit.IgnitionUt.HasValue)
            {
                if (!IsFinite(edit.IgnitionUt.Value))
                {
                    return NotFinite("ignition instant");
                }
                if (!Fields.Set(burn, PrincipiaBurnStruct.InitialTimeField, edit.IgnitionUt.Value))
                {
                    return ShapeChanged(PrincipiaBurnStruct.InitialTimeField);
                }
            }

            if (edit.InertiallyFixed.HasValue
                && !Fields.Set(
                    burn, PrincipiaBurnStruct.InertiallyFixedField, edit.InertiallyFixed.Value))
            {
                return ShapeChanged(PrincipiaBurnStruct.InertiallyFixedField);
            }

            var wantsComponents =
                edit.DeltaVTangent.HasValue || edit.DeltaVNormal.HasValue
                || edit.DeltaVBinormal.HasValue;
            if (wantsComponents)
            {
                var coordinates = Fields.CoordinateSystem(burn);
                if (coordinates != PrincipiaBurnStruct.CartesianTnb)
                {
                    return PrincipiaWriteResult.Refused(
                        PrincipiaWriteRefusal.BurnFrameUnsupported,
                        "This burn's Dv is expressed in one of Principia's spherical coordinate "
                        + "systems (kind " + (coordinates?.ToString() ?? "unknown") + "), which "
                        + "carries a magnitude and two angles rather than three components. "
                        + "Writing components onto it would set a triple the plugin does not read, "
                        + "so the burn would come back unchanged and look like a write that landed. "
                        + "Switch the burn to Cartesian in-game first.");
                }

                var current = Fields.DeltaV(burn);
                if (current == null)
                {
                    return ShapeChanged(PrincipiaBurnStruct.XyzField);
                }
                var tangent = edit.DeltaVTangent ?? current.Value.X;
                var normal = edit.DeltaVNormal ?? current.Value.Y;
                var binormal = edit.DeltaVBinormal ?? current.Value.Z;
                if (!IsFinite(tangent) || !IsFinite(normal) || !IsFinite(binormal))
                {
                    return NotFinite("Dv component");
                }
                if (!Fields.SetDeltaV(burn, tangent, normal, binormal))
                {
                    return ShapeChanged(PrincipiaBurnStruct.XyzField);
                }
            }

            if (edit.Profile == PrincipiaBurnProfile.InstantImpulse)
            {
                if (initialMassTons == null || !IsFinite(initialMassTons.Value)
                    || initialMassTons.Value <= 0)
                {
                    return PrincipiaWriteResult.Refused(
                        PrincipiaWriteRefusal.ValueNotFinite,
                        "The instant-impulse profile scales thrust by the burn's mass at ignition, "
                        + "and that mass could not be read, so there is nothing to scale.");
                }
                var thrust = initialMassTons.Value * InstantImpulseThrustPerTonne;
                if (!Fields.Set(burn, PrincipiaBurnStruct.ThrustField, thrust)
                    || !Fields.Set(
                        burn,
                        PrincipiaBurnStruct.SpecificImpulseField,
                        InstantImpulseSpecificImpulseSeconds))
                {
                    return ShapeChanged(PrincipiaBurnStruct.ThrustField);
                }
            }

            return null;
        }

        private static PrincipiaWriteResult NotFinite(string what) =>
            PrincipiaWriteResult.Refused(
                PrincipiaWriteRefusal.ValueNotFinite,
                "The requested " + what + " is not a finite number.");

        private static PrincipiaWriteResult ShapeChanged(string field) =>
            PrincipiaWriteResult.Refused(
                PrincipiaWriteRefusal.PluginShapeChanged,
                "Principia's burn struct would not accept a value for '" + field
                + "', so it is not the shape this Uplink was audited against.");

        private static bool IsFinite(double value) =>
            !double.IsNaN(value) && !double.IsInfinity(value);
    }

    /// <summary>
    /// What a step-parameter struct must satisfy before it goes back to the plugin.
    ///
    /// <para><b>The two integrator kinds are the reason this exists.</b> They are
    /// drawn from disjoint sets over two different equations: the plan's own
    /// equation accepts exactly one value, the generalized equation accepts two
    /// others, and there is no overlap. Handing over the wrong one reaches an
    /// abort with no message and no log line, so the failure is indistinguishable
    /// at runtime from several unrelated ones. Checking them is cheap, and it is
    /// the check that catches a shape change in the one struct where a shape change
    /// is undiagnosable.</para>
    /// </summary>
    public static class PrincipiaIntegratorRules
    {
        internal const string IntegratorKindField = "integrator_kind";
        internal const string GeneralizedIntegratorKindField = "generalized_integrator_kind";
        internal const string MaxStepsField = "max_steps";
        internal const string LengthToleranceField = "length_integration_tolerance";
        internal const string SpeedToleranceField = "speed_integration_tolerance";

        private static readonly PrincipiaBurnStruct Fields = new PrincipiaBurnStruct();

        /// <summary>Why this struct must not be written, or null.</summary>
        public static PrincipiaWriteResult? Reject(object parameters)
        {
            var kind = Fields.GetInt(parameters, IntegratorKindField);
            var generalized = Fields.GetInt(parameters, GeneralizedIntegratorKindField);
            if (kind == null || generalized == null)
            {
                return PrincipiaWriteResult.Refused(
                    PrincipiaWriteRefusal.PluginShapeChanged,
                    "Principia's step-parameter struct does not carry both integrator kinds where "
                    + "this Uplink expects them, so it is not the shape that was audited.");
            }
            if (kind.Value != PrincipiaPlanWriteGate.RequiredIntegratorKind)
            {
                return PrincipiaWriteResult.Refused(
                    PrincipiaWriteRefusal.IntegratorKindUnexpected,
                    "The plan's integrator kind read back as " + kind.Value + ", not "
                    + PrincipiaPlanWriteGate.RequiredIntegratorKind
                    + ". Writing it back could abort the game with no message, because the two "
                    + "kind fields are drawn from disjoint sets and this is what a shape change "
                    + "between them looks like.");
            }
            if (Array.IndexOf(
                    PrincipiaPlanWriteGate.AllowedGeneralizedIntegratorKinds, generalized.Value) < 0)
            {
                return PrincipiaWriteResult.Refused(
                    PrincipiaWriteRefusal.IntegratorKindUnexpected,
                    "The plan's generalized integrator kind read back as " + generalized.Value
                    + ", which is not one this build's equation accepts.");
            }

            var steps = Fields.GetDouble(parameters, MaxStepsField);
            if (steps == null
                || steps.Value < PrincipiaPlanWriteGate.MinMaxSteps
                || steps.Value > PrincipiaPlanWriteGate.MaxMaxSteps)
            {
                return PrincipiaWriteResult.Refused(
                    PrincipiaWriteRefusal.IntegratorBoundsExceeded,
                    "A step limit of " + (steps?.ToString() ?? "nothing") + " is outside the "
                    + PrincipiaPlanWriteGate.MinMaxSteps + " to "
                    + PrincipiaPlanWriteGate.MaxMaxSteps + " Principia's own control offers.");
            }

            var length = Fields.GetDouble(parameters, LengthToleranceField);
            var speed = Fields.GetDouble(parameters, SpeedToleranceField);
            foreach (var tolerance in new[] { length, speed })
            {
                if (tolerance == null
                    || tolerance.Value < PrincipiaPlanWriteGate.MinTolerance
                    || tolerance.Value > PrincipiaPlanWriteGate.MaxTolerance)
                {
                    return PrincipiaWriteResult.Refused(
                        PrincipiaWriteRefusal.IntegratorBoundsExceeded,
                        "A tolerance of " + (tolerance?.ToString() ?? "nothing") + " is outside "
                        + "the " + PrincipiaPlanWriteGate.MinTolerance + " to "
                        + PrincipiaPlanWriteGate.MaxTolerance + " Principia's own controls offer. "
                        + "A non-positive one is an assertion failure inside the plugin.");
                }
            }

            return null;
        }

        /// <summary>
        /// Puts the three requested numbers onto a struct read back from the plugin,
        /// leaving the two integrator kinds exactly as they came.
        /// </summary>
        public static PrincipiaWriteResult? Apply(
            object parameters, PrincipiaPlanIntegratorArgs request)
        {
            if (request.MaxSteps.HasValue
                && !Fields.Set(parameters, MaxStepsField, (long)request.MaxSteps.Value))
            {
                return Unsettable(MaxStepsField);
            }
            if (request.LengthToleranceMetres.HasValue
                && !Fields.Set(parameters, LengthToleranceField, request.LengthToleranceMetres.Value))
            {
                return Unsettable(LengthToleranceField);
            }
            if (request.SpeedToleranceMetresPerSecond.HasValue
                && !Fields.Set(
                    parameters, SpeedToleranceField, request.SpeedToleranceMetresPerSecond.Value))
            {
                return Unsettable(SpeedToleranceField);
            }
            return null;
        }

        private static PrincipiaWriteResult Unsettable(string field) =>
            PrincipiaWriteResult.Refused(
                PrincipiaWriteRefusal.PluginShapeChanged,
                "Principia's step-parameter struct would not accept a value for '" + field + "'.");
    }
}
