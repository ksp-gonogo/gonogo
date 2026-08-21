namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// The settings that only the plugin knows, read through the precondition
    /// protocol and nowhere else.
    ///
    /// <para><b>Why these do not come off the producer's windows like the rest.</b>
    /// Its settings UI keeps the prediction tolerance and step count as INDICES
    /// into two static tables, and it recomputes both on every repaint from the
    /// plugin's per-vessel parameters. Unrepainted they sit at their constructor
    /// defaults, which resolve to a plausible tolerance and a plausible step count
    /// with no tell, so a poll of those fields hands an operator a fabricated
    /// basis for judging every other number on the screen. Worse than a wrong
    /// value: a wrong yardstick.</para>
    ///
    /// <para>Reading the plugin's own per-vessel struct answers the question the
    /// slider was only ever a picture of: what this vessel's prediction ACTUALLY
    /// integrated to. It also removes the need for a render patch, and it works
    /// from the first tick rather than from the first time the operator happened
    /// to open a window.</para>
    ///
    /// <para>Every read here goes through a gate that was minted this frame.
    /// Nothing in this file holds a guid, an index or a handle of its own, which
    /// is the whole reason the layer beneath it is shaped the way it is.</para>
    /// </summary>
    public sealed class NativeSettingsReader
    {
        private const string LengthToleranceMember = "length_integration_tolerance";
        private const string MaxStepsMember = "max_steps";
        private const string ManoeuvreBurnMember = "burn";
        private const string BurnFrameMember = "frame";

        private readonly ReflectedMembers _m = new ReflectedMembers();
        private readonly SettingsReflection _frames = new SettingsReflection();

        /// <summary>
        /// Fills in everything the plugin owns, or leaves it all null.
        ///
        /// <para>Null in, null out at every step: no session, no vessel guid, a
        /// vessel the plugin no longer knows, or a vessel with no plan each cost
        /// exactly the settings that depend on them. A vessel it no longer knows is
        /// the ordinary case rather than a fault, and it is the one this protocol
        /// exists for: the alternative to publishing nothing there is not a stale
        /// number, it is the player's game ending.</para>
        /// </summary>
        public void Read(ISettingsSource source, SettingsObservation into)
        {
            var session = source.Session;
            var guid = source.ActiveVesselGuid;
            if (session == null || string.IsNullOrEmpty(guid))
            {
                return;
            }
            if (!session.TryBeginFrame(out var frame) || frame == null)
            {
                return;
            }
            using (frame)
            {
                if (!frame.TryVessel(guid, out var vessel))
                {
                    return;
                }

                into.PredictionVesselId = vessel.Guid;
                ReadStepParameters(
                    vessel.PredictionAdaptiveStepParameters(),
                    out into.PredictionToleranceMetres,
                    out into.PredictionMaxSteps);

                into.FlightPlanCount = vessel.FlightPlanCount();
                into.SelectedFlightPlan = vessel.SelectedFlightPlan();

                if (!vessel.TryFlightPlan(out var plan))
                {
                    return;
                }

                ReadStepParameters(
                    plan.AdaptiveStepParameters(),
                    out into.PlanToleranceMetres,
                    out into.PlanMaxSteps);

                into.PlanInitialTimeUt = plan.InitialTime();
                into.PlanDesiredFinalTimeUt = plan.DesiredFinalTime();
                into.PlanActualFinalTimeUt = plan.ActualFinalTime();

                foreach (var manoeuvre in plan.Manoeuvres())
                {
                    var burnFrame = BurnFrame(manoeuvre.Manoeuvre(), source.Celestials);
                    if (burnFrame != null)
                    {
                        into.BurnFrames.Add(burnFrame);
                    }
                }
            }
        }

        /// <summary>
        /// The two halves of an integrator bound, from whichever of the producer's
        /// two parameter structs it came from.
        ///
        /// <para>They share these two member names and differ only in a field this
        /// reading does not want, so one accessor serves both. They travel together
        /// because neither means much alone: a tight tolerance with a low step
        /// limit is a trajectory that stops early, not an accurate one.</para>
        /// </summary>
        private void ReadStepParameters(
            object? parameters, out double? toleranceMetres, out double? maxSteps)
        {
            toleranceMetres = null;
            maxSteps = null;
            if (parameters == null)
            {
                return;
            }
            toleranceMetres = _m.ReadDouble(parameters, LengthToleranceMember);
            maxSteps = _m.ReadDouble(parameters, MaxStepsMember);
        }

        /// <summary>
        /// One burn's manœuvring frame, taken from the plugin's own manœuvre rather
        /// than from the burn editor beside it.
        ///
        /// <para>The editor is a mirror of this, refreshed only while its window is
        /// drawing, so it answers for whenever the operator last looked. The plugin
        /// answers for now, which is what a warning that a burn's Δv is in a
        /// different frame from the plotting one has to do.</para>
        /// </summary>
        private FrameObservation? BurnFrame(object? manoeuvre, ICelestialNames celestials)
        {
            var burn = manoeuvre == null ? null : _m.Value(manoeuvre, ManoeuvreBurnMember);
            var descriptor = burn == null ? null : _m.Value(burn, BurnFrameMember);
            return descriptor == null
                ? null
                : _frames.FrameFromIndices(descriptor, celestials, "burn");
        }
    }
}
