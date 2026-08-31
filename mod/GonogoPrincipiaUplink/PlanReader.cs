using System;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// Reads the selected flight plan out of the plugin, inside one frame, through
    /// the gates that carry the preconditions.
    ///
    /// <para><b>The plugin, because the window was never an option.</b> There used
    /// to be a mirror of the producer's planner window beside this reader, and its
    /// fields refresh only while that window renders, so it answered only when the
    /// player happened to have the panel open. It is gone. This reading is the
    /// plugin's own answer, available whenever there is a session, and it is also
    /// the reading a write has to be validated against: an editor showing one
    /// number while the write gate checks another is worse than an editor with
    /// fewer numbers.</para>
    ///
    /// <para>Per-burn reads are not free, and this runs every tick, so the cost is
    /// stated rather than assumed: one native call per burn plus six for the plan,
    /// against a producer maximum of ten plans and no cap on burns. If a plan ever
    /// gets long enough for that to matter, the fix is a cadence rather than a
    /// partial reading, because a plan read half from this tick and half from the
    /// last is not a plan.</para>
    /// </summary>
    public sealed class PlanReader
    {
        private static readonly PrincipiaBurnStruct Fields = new PrincipiaBurnStruct();

        /// <summary>
        /// The shared reflection helper, for the one thing here that is a managed
        /// object rather than a native struct: the plugin's status type. Its
        /// invoke allowlist is the reason <c>ok</c> can be called at all.
        /// </summary>
        private static readonly ReflectedMembers Members = new ReflectedMembers();

        private const string StatusErrorMember = "error";
        private const string StatusMessageMember = "message";
        private const string StatusOkMethod = "ok";

        /// <summary>
        /// The producer's <c>DEADLINE_EXCEEDED</c>, reproduced rather than asked.
        ///
        /// <para>Its own type states this as <c>is_deadline_exceeded()</c>, whose
        /// whole body is <c>return error == 4;</c>, and asking the predicate would
        /// be better on the same reasoning that has <c>ok</c> preferred over a
        /// comparison with zero. It is a comparison here because invoking it would
        /// mean a new entry on <see cref="ReflectedMembers.InvocableMembers"/>, and
        /// that list is a safety allowlist rather than a formality: every name on it
        /// records an audit. Both members are on the same small status class, both
        /// bodies are a single field comparison, and the audit is written here
        /// instead. Worth revisiting as a one-line change if that list is being
        /// touched anyway.</para>
        /// </summary>
        private const int DeadlineExceededError = 4;

        /// <summary>
        /// The same frame resolver the settings reading uses, rather than a second
        /// one beside it. A burn's frame arrives as body INDICES on a descriptor,
        /// and the rules for turning those into names are not obvious: which slot a
        /// kind actually reads, that a side can be a set rather than a body, and
        /// that "no body" is a real value. Two copies of that would be two things
        /// to keep in step, and the frame a burn is quoted in is not a place to
        /// discover they have drifted.
        /// </summary>
        private static readonly SettingsReflection Frames = new SettingsReflection();

        /// <summary>
        /// The plan for <paramref name="vesselGuid"/>, or null when there is
        /// nothing to say: no session, no plugin, or a vessel the plugin has
        /// forgotten.
        ///
        /// <para>Null is "we could not look", which is a different fact from
        /// <see cref="PlanObservation.PlanExists"/> being false, and the two must
        /// not collapse: an operator told "no plan" for a vessel that has one stops
        /// looking, on the channel whose whole job is to keep them looking.</para>
        /// </summary>
        public PlanObservation? Read(
            PrincipiaSession? session,
            string? vesselGuid,
            double nowUt,
            ICelestialNames? celestials)
        {
            if (session == null || string.IsNullOrEmpty(vesselGuid))
            {
                return null;
            }

            using var frame = Open(session);
            return frame == null
                ? null
                : ReadInFrame(session, frame, vesselGuid!, nowUt, celestials);
        }

        /// <summary>
        /// The same reading, inside a frame the caller already opened.
        ///
        /// <para>Separate because a write has to be followed by a re-read IN THE
        /// SAME FRAME, and opening a second frame is not a smaller version of that:
        /// opening one bumps the session's generation and kills every gate the first
        /// one handed out, so a reader that opens its own frame cannot be called from
        /// inside a write.</para>
        /// </summary>
        public PlanObservation? ReadInFrame(
            PrincipiaSession session,
            PrincipiaFrame frame,
            string vesselGuid,
            double nowUt,
            ICelestialNames? celestials)
        {
            if (!frame.TryVessel(vesselGuid, out var vessel))
            {
                return null;
            }

            var observation = new PlanObservation
            {
                VesselId = vesselGuid,
                SampledAtUt = nowUt,
                PlanCount = vessel.FlightPlanCount(),
                SelectedPlan = vessel.SelectedFlightPlan(),
                WriteAnalysedVersion = session.Writes.AnalysedVersion,
                WriteDetectedVersion = session.Writes.DetectedVersion,
            };

            if (!vessel.TryFlightPlan(out var plan))
            {
                observation.PlanExists = false;
                DescribeWriteSurface(session, vesselGuid, observation, planExists: false);
                return observation;
            }

            observation.PlanExists = true;
            var materialised = plan.Materialise();
            observation.DesiredFinalTimeUt = materialised.DesiredFinalTimeUt;
            observation.InitialTimeUt = plan.InitialTime();
            observation.ActualFinalTimeUt = plan.ActualFinalTime();
            observation.AnomalousBurnCount = plan.NumberOfAnomalousManoeuvres();
            ReadStatus(plan.AnomalousStatus(), observation);
            observation.OptimisationRunning = materialised.OptimisationManoeuvreIndex() >= 0;
            ReadIntegrator(plan.AdaptiveStepParameters(), observation);
            ReadBurns(plan, observation, nowUt, celestials);
            DescribeWriteSurface(session, vesselGuid, observation, planExists: true);
            return observation;
        }

        /// <summary>
        /// Opens the frame, answering null rather than throwing when there is no
        /// plugin. A frame is per-tick and per-callback; nothing here holds one.
        /// </summary>
        private static PrincipiaFrame? Open(PrincipiaSession session) =>
            session.TryBeginFrame(out var frame) ? frame : null;

        private static void DescribeWriteSurface(
            PrincipiaSession session, string vesselGuid, PlanObservation observation, bool planExists)
        {
            var writes = session.Writes;
            observation.WriteSurfaceAvailable = writes.Available;
            observation.WriteSurfaceArmed = writes.IsArmed(vesselGuid);

            var unavailable = writes.UnavailableReason;
            if (unavailable != null)
            {
                observation.WriteSurfaceReason = unavailable;
                return;
            }
            if (!planExists)
            {
                observation.WriteSurfaceReason =
                    "This vessel has no flight plan. Creating one is the only edit available.";
                return;
            }
            if (!observation.WriteSurfaceArmed)
            {
                observation.WriteSurfaceReason =
                    "Not armed. Arming runs a round trip of Principia's own burn through the "
                    + "plugin and back, which is the only way to establish that the struct this "
                    + "build takes is the struct it hands out.";
                return;
            }
            if (writes.LayoutFailure != null && !writes.BurnLayoutVerified)
            {
                observation.WriteSurfaceReason = writes.LayoutFailure;
                return;
            }
            observation.WriteSurfaceReason = null;
        }

        /// <summary>
        /// The plan's integration status, as a tri-state.
        ///
        /// <para><see cref="PlanObservation.PlanIntegrated"/> is left null when the
        /// status cannot be read at all, and that is the important case: resolving
        /// an unreadable status to "integrated" would report health from a failed
        /// read, and a plan whose status we cannot see is a plan we cannot vouch
        /// for.</para>
        ///
        /// <para>Prefers the producer's own <c>ok()</c> predicate over comparing
        /// the code against zero. The codes are its vocabulary and its predicate is
        /// the definition; assuming a convention here would be a second place that
        /// has to stay in step with it. The deadline flag is the exception and says
        /// why at <see cref="DeadlineExceededError"/>.</para>
        /// </summary>
        private static void ReadStatus(object? status, PlanObservation observation)
        {
            if (status == null)
            {
                return;
            }
            var error = Members.ReadInt(status, StatusErrorMember);
            var ok = Members.InvokeBool(status, StatusOkMethod);
            if (ok == null && error == null)
            {
                return;
            }
            observation.PlanIntegrated = ok ?? error == 0;
            observation.ReachedDeadline = error == DeadlineExceededError;
            if (observation.PlanIntegrated != true)
            {
                observation.StatusError = error;
                observation.StatusMessage = Members.Value(status, StatusMessageMember) as string;
            }
        }

        private static void ReadIntegrator(object? parameters, PlanObservation observation)
        {
            if (parameters == null)
            {
                return;
            }
            observation.MaxSteps =
                Fields.GetDouble(parameters, PrincipiaIntegratorRules.MaxStepsField);
            observation.LengthToleranceMetres =
                Fields.GetDouble(parameters, PrincipiaIntegratorRules.LengthToleranceField);
            observation.SpeedToleranceMetresPerSecond =
                Fields.GetDouble(parameters, PrincipiaIntegratorRules.SpeedToleranceField);
            observation.IntegratorKind =
                Fields.GetDouble(parameters, PrincipiaIntegratorRules.IntegratorKindField);
            observation.GeneralizedIntegratorKind =
                Fields.GetDouble(
                    parameters, PrincipiaIntegratorRules.GeneralizedIntegratorKindField);
        }

        private static void ReadBurns(
            PrincipiaFlightPlanGate plan,
            PlanObservation observation,
            double nowUt,
            ICelestialNames? celestials)
        {
            var cursor = plan.Manoeuvres();
            var count = cursor.Count;
            var anomalous = observation.AnomalousBurnCount ?? 0;
            foreach (var burn in cursor)
            {
                var manoeuvre = burn.Manoeuvre();
                if (manoeuvre == null)
                {
                    continue;
                }
                var described = Describe(manoeuvre, burn.Ordinal, count, anomalous, nowUt, celestials);
                observation.Burns.Add(described);

                // The producer's own rule, from its planner window: the first burn
                // whose CUTOFF is still ahead, not the first whose ignition is. A
                // burn already under way is the one being flown rather than the next
                // one, and calling it past would point an operator at the burn after
                // the one their engines are lit for.
                if (observation.FirstFutureBurnIndex == null
                    && described.CutoffUt != null
                    && described.CutoffUt > nowUt)
                {
                    observation.FirstFutureBurnIndex = described.Index;
                }
            }
        }

        /// <summary>
        /// One manoeuvre, flattened.
        ///
        /// <para>The Dv triple is only the whole story for the producer's Cartesian
        /// coordinate system; under its three spherical ones the same struct carries
        /// a magnitude and two angles in a different field. The components are
        /// published either way and the coordinate system travels with them, because
        /// suppressing them would leave a client unable to tell a spherical burn from
        /// an unreadable one.</para>
        /// </summary>
        internal static PlannedBurnObservation Describe(
            object manoeuvre,
            int index,
            int burnCount,
            int anomalousCount,
            double nowUt,
            ICelestialNames? celestials)
        {
            var burn = Fields.Get(manoeuvre, PrincipiaBurnStruct.ManoeuvreBurnField);
            var ignition = burn == null
                ? null
                : Fields.GetDouble(burn, PrincipiaBurnStruct.InitialTimeField);
            var cutoff = Fields.GetDouble(manoeuvre, PrincipiaBurnStruct.ManoeuvreFinalTimeField);
            var deltaV = burn == null ? null : Fields.DeltaV(burn);
            var extension = burn == null ? null : Fields.FrameExtension(burn);
            var descriptor = burn == null
                ? null
                : Fields.Get(burn, PrincipiaBurnStruct.FrameField);

            return new PlannedBurnObservation
            {
                Index = index,
                IgnitionUt = ignition,
                CutoffUt = cutoff,
                DurationSeconds =
                    Fields.GetDouble(manoeuvre, PrincipiaBurnStruct.ManoeuvreDurationField),
                TimeToHalfDeltaVSeconds =
                    Fields.GetDouble(manoeuvre, PrincipiaBurnStruct.ManoeuvreTimeToHalfDeltaVField),
                DeltaVTangent = deltaV?.X,
                DeltaVNormal = deltaV?.Y,
                DeltaVBinormal = deltaV?.Z,
                CoordinateSystem = burn == null ? null : Fields.CoordinateSystem(burn),
                InertiallyFixed = burn == null
                    ? null
                    : Fields.GetBool(burn, PrincipiaBurnStruct.InertiallyFixedField),
                ThrustKilonewtons = burn == null
                    ? null
                    : Fields.GetDouble(burn, PrincipiaBurnStruct.ThrustField),
                SpecificImpulseSeconds = burn == null
                    ? null
                    : Fields.GetDouble(burn, PrincipiaBurnStruct.SpecificImpulseField),
                InitialMassTons =
                    Fields.GetDouble(manoeuvre, PrincipiaBurnStruct.ManoeuvreInitialMassField),
                FinalMassTons =
                    Fields.GetDouble(manoeuvre, PrincipiaBurnStruct.ManoeuvreFinalMassField),
                MassFlowKilogramsPerSecond =
                    Fields.GetDouble(manoeuvre, PrincipiaBurnStruct.ManoeuvreMassFlowField),
                FrameType = extension,
                Frame = descriptor == null || celestials == null
                    ? null
                    : Frames.FrameFromIndices(descriptor, celestials, "burn"),
                FrameEditable =
                    extension != null && PrincipiaBurnStruct.IsEditableFrame(extension.Value),
                Executing = ignition != null && cutoff != null
                    && nowUt >= ignition.Value && nowUt <= cutoff.Value,
                Anomalous = IsAnomalous(index, burnCount, anomalousCount),
            };
        }

        /// <summary>
        /// Whether the burn at <paramref name="index"/> is one of the
        /// <paramref name="anomalousCount"/> the plugin flagged, given a plan of
        /// <paramref name="burnCount"/> burns.
        ///
        /// <para>The rule is read off the producer's own call site, which passes
        /// <c>index &gt;= count - n</c> as its anomalous flag. A negative or
        /// oversized count is clamped rather than trusted: it arrives from a
        /// reflected read, and an out-of-range value should narrow to "flag nothing"
        /// or "flag everything" instead of throwing.</para>
        ///
        /// <para>Resolved here rather than left to the client, so no consumer has to
        /// reimplement a last-n rule that is the producer's and not ours.</para>
        /// </summary>
        internal static bool IsAnomalous(int index, int burnCount, int anomalousCount)
        {
            if (anomalousCount <= 0)
            {
                return false;
            }
            if (anomalousCount >= burnCount)
            {
                return true;
            }
            return index >= burnCount - anomalousCount;
        }

        /// <summary>The magnitude of a Dv triple, or null when a component could
        /// not be read. Derived rather than asked for: the plugin's own magnitude
        /// lives on a window control, and a second source for a number this simple
        /// is a second thing to disagree with.</summary>
        internal static double? Magnitude(double? x, double? y, double? z)
        {
            if (x == null || y == null || z == null)
            {
                return null;
            }
            return Math.Sqrt(x.Value * x.Value + y.Value * y.Value + z.Value * z.Value);
        }
    }
}
