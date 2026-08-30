using System;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// Reads the selected flight plan out of the plugin, inside one frame, through
    /// the gates that carry the preconditions.
    ///
    /// <para><b>Why the plugin and not the producer's window.</b> The window mirror
    /// beside this one is safer and less complete: it cannot abort, it survives a
    /// burn whose frame the plugin refuses to describe, and it carries a Dv
    /// magnitude where tuning needs the triple. This reading is the plugin's own
    /// answer, which is the only place the triple, the mass flow and each burn's
    /// frame exist, and it is also the reading a write has to be validated
    /// against: an editor showing one number while the write gate checks another is
    /// worse than an editor with fewer numbers.</para>
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
                observation.Burns.Add(
                    Describe(manoeuvre, burn.Ordinal, count, anomalous, nowUt, celestials));
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
                Anomalous = FlightPlanBuilder.IsAnomalous(index, burnCount, anomalousCount),
            };
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
