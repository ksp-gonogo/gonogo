using System.Collections;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// Reads a flight plan off the integrator's own planner instance, by reflection
    /// and nothing else.
    ///
    /// <para>No compile-time reference to any Principia assembly, and no native
    /// call: every member below is a managed field, a property over a field, or a
    /// parameterless managed method whose body was read and confirmed to touch no
    /// plugin. That distinction is the whole safety argument, so it is worth being
    /// exact about the one thing this class deliberately does NOT read:
    /// <c>BurnEditor.time_base</c> is a property like the others, and it calls into
    /// the native plugin with a guid argument. Every other property on that class
    /// is a field read. Nothing here needs <c>time_base</c>, and nothing here may
    /// start using it.</para>
    ///
    /// <para>Caching, tolerance and the invoke rule all live in
    /// <see cref="ReflectedMembers"/>, which is shared with the provenance reader.
    /// The caching matters here in particular: this runs from a render postfix, so
    /// an uncached version would do a dozen name lookups per burn per repaint.</para>
    ///
    /// <para>Every read is individually tolerant: a member that cannot be resolved
    /// leaves its field null rather than failing the whole observation. A version of
    /// the integrator that renamed one field should cost that one value, not the
    /// plan. The exception is the integration status, where an unreadable value must
    /// resolve to "unknown" and never to "fine": see
    /// <see cref="FlightPlanObservation.PlanIntegrated"/>.</para>
    /// </summary>
    public sealed class FlightPlanReflection
    {
        private const string BurnEditorsField = "burn_editors_";
        private const string ReachedDeadlineField = "reached_deadline_";
        private const string StatusField = "status_";
        private const string FirstErrorManoeuvreField = "first_error_manœuvre_";
        private const string FirstFutureManoeuvreField = "first_future_manœuvre_";
        private const string AnomalousCountField = "number_of_anomalous_manœuvres_";
        private const string FinalTimeField = "final_time_";

        private const string SliderValueMember = "value";

        private const string BurnInitialTimeMember = "initial_time";
        private const string BurnFinalTimeMember = "final_time";
        private const string BurnDeltaVMethod = "Δv";
        private const string BurnDurationField = "duration_";
        private const string BurnThrustField = "thrust_in_kilonewtons_";
        private const string BurnIspField = "specific_impulse_in_seconds_g0_";
        private const string BurnInitialMassField = "initial_mass_in_tonnes_";
        private const string BurnInertiallyFixedField = "is_inertially_fixed_";
        private const string BurnCoordinateSystemField = "coordinate_system_";

        private const string StatusErrorMember = "error";
        private const string StatusMessageMember = "message";
        private const string StatusOkMethod = "ok";

        private const string PredictedVesselMember = "predicted_vessel";
        private const string VesselIdMember = "id";

        private readonly ReflectedMembers _m = new ReflectedMembers();

        /// <summary>
        /// The plan on <paramref name="planner"/> as of now, attributed to
        /// <paramref name="vesselId"/> and stamped with <paramref name="observedAtUt"/>.
        ///
        /// <para><paramref name="planExists"/> is passed in rather than probed,
        /// because only the caller knows it: the observed method is invoked by the
        /// planner only when a plan exists, so being called IS the evidence, and
        /// there is no field here that carries the same fact.</para>
        /// </summary>
        public FlightPlanObservation Read(
            object planner,
            string? vesselId,
            double observedAtUt,
            bool planExists)
        {
            var observation = new FlightPlanObservation
            {
                VesselId = vesselId,
                ObservedAtUt = observedAtUt,
                PlanExists = planExists,
                ReachedDeadline = _m.ReadBool(planner, ReachedDeadlineField) ?? false,
                FirstErrorBurnIndex = _m.ReadInt(planner, FirstErrorManoeuvreField),
                FirstFutureBurnIndex = _m.ReadInt(planner, FirstFutureManoeuvreField),
                AnomalousBurnCount = _m.ReadInt(planner, AnomalousCountField) ?? 0,
                FinalTimeUt = ReadSliderValue(_m.Value(planner, FinalTimeField)),
            };

            ReadStatus(_m.Value(planner, StatusField), observation);
            ReadBurns(_m.Value(planner, BurnEditorsField), observation);
            return observation;
        }

        /// <summary>
        /// The integration status, as a tri-state.
        ///
        /// <para><c>PlanIntegrated</c> is left null when the status cannot be read at
        /// all, and that is the important case: resolving an unreadable status to
        /// "integrated" would report health from a failed reflection, which is
        /// exactly the reading this whole channel exists to make impossible. A plan
        /// whose status we cannot see is a plan we cannot vouch for.</para>
        ///
        /// <para>Prefers the integrator's own <c>ok()</c> predicate over comparing
        /// the code against zero. The codes are the integrator's vocabulary and its
        /// own predicate is the definition; assuming a convention here would be a
        /// second place that has to stay in step with it.</para>
        /// </summary>
        private void ReadStatus(object? status, FlightPlanObservation observation)
        {
            if (status == null)
            {
                return;
            }
            var error = _m.ReadInt(status, StatusErrorMember);
            var ok = _m.InvokeBool(status, StatusOkMethod);
            if (ok == null && error == null)
            {
                return;
            }
            observation.PlanIntegrated = ok ?? error == 0;
            if (observation.PlanIntegrated != true)
            {
                observation.StatusError = error;
                observation.StatusMessage = _m.Value(status, StatusMessageMember) as string;
            }
        }

        private void ReadBurns(object? burnEditors, FlightPlanObservation observation)
        {
            if (burnEditors is not IEnumerable editors)
            {
                return;
            }
            var index = 0;
            foreach (var editor in editors)
            {
                if (editor == null)
                {
                    index++;
                    continue;
                }
                observation.Burns.Add(new BurnObservation
                {
                    Index = index,
                    IgnitionUt = _m.ReadDouble(editor, BurnInitialTimeMember),
                    CutoffUt = _m.ReadDouble(editor, BurnFinalTimeMember),
                    DurationSeconds = _m.ReadDouble(editor, BurnDurationField),
                    DeltaV = _m.InvokeDouble(editor, BurnDeltaVMethod),
                    ThrustKilonewtons = _m.ReadDouble(editor, BurnThrustField),
                    SpecificImpulseSeconds = _m.ReadDouble(editor, BurnIspField),
                    InitialMassTons = _m.ReadDouble(editor, BurnInitialMassField),
                    InertiallyFixed = _m.ReadBool(editor, BurnInertiallyFixedField),
                    CoordinateSystem = _m.ReadInt(editor, BurnCoordinateSystemField),
                });
                index++;
            }
        }

        /// <summary>
        /// The guid of the vessel the planner is predicting, or null when it has
        /// none.
        ///
        /// <para>Reached by reflection through the vessel object rather than by
        /// referencing the game's vessel type, so this class keeps its property of
        /// needing no compile-time reference to anything but the framework. The
        /// planner's own render does the same walk, one member at a time.</para>
        /// </summary>
        public string? PredictedVesselId(object planner)
        {
            var vessel = _m.Value(planner, PredictedVesselMember);
            var id = vessel == null ? null : _m.Value(vessel, VesselIdMember);
            var text = id?.ToString();
            return string.IsNullOrEmpty(text) ? null : text;
        }

        /// <summary>The slider's current value. A `DifferentialSlider` is a UI
        /// control, so the plan's end instant is a property on it rather than a
        /// double on the planner.</summary>
        private double? ReadSliderValue(object? slider) =>
            slider == null ? null : _m.ReadDouble(slider, SliderValueMember);

    }
}
