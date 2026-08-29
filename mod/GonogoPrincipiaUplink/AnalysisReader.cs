using System;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// Reads the producer's orbit analyses through the two accessors that were
    /// built for them and never called.
    ///
    /// <para><b>Neither read starts an analysis.</b> The vessel accessor publishes
    /// a result the producer's own worker thread already finished and reads it;
    /// the coast accessor does the same for analyses the producer requests inside
    /// every flight-plan recompute. Nothing here asks for one, so nothing here can
    /// interrupt one, and the vessel whose analyser the player is watching is
    /// untouched.</para>
    ///
    /// <para><b>Main thread only.</b> The producer describes the analysis slot as
    /// read and cleared by the main thread, and the publication step this read
    /// performs writes it. There is no evidence it is safe off the main thread, so
    /// this runs where the plan reading beside it runs.</para>
    ///
    /// <para><b>The recurrence arrives without being asked for.</b> Both accessors
    /// take an optional recurrence hypothesis this Uplink does not supply, and for
    /// most of this Uplink's life that was believed to forfeit the ground-track
    /// recurrence and the equatorial crossings. It does not. The producer fits a
    /// closest recurrence during the analysis itself, and its no-hypothesis path
    /// falls BACK to that one rather than clearing it, deriving the crossings on
    /// the way. Supplying a pair is an operator's manual override for comparing
    /// against a nominal orbit, not a precondition for getting an answer.</para>
    ///
    /// <para>So the recurrence is read here. The solar times of nodes are a
    /// separate field and are still not read, which is a gap rather than a
    /// trade.</para>
    /// </summary>
    public sealed class AnalysisReader
    {
        private static readonly PrincipiaBurnStruct Fields = new PrincipiaBurnStruct();

        /// <summary>Fields on the analysis itself.</summary>
        internal const string ProgressField = "progress_of_next_analysis";
        internal const string PrimaryIndexField = "primary_index";
        internal const string MissionDurationField = "mission_duration";
        internal const string ElementsField = "elements";

        /// <summary>Fields on the elements.</summary>
        internal const string SiderealPeriodField = "sidereal_period";
        internal const string NodalPeriodField = "nodal_period";
        internal const string AnomalisticPeriodField = "anomalistic_period";
        internal const string NodalPrecessionField = "nodal_precession";
        internal const string MeanSemimajorAxisField = "mean_semimajor_axis";
        internal const string MeanEccentricityField = "mean_eccentricity";
        internal const string MeanInclinationField = "mean_inclination";
        internal const string MeanLongitudeOfAscendingNodesField =
            "mean_longitude_of_ascending_nodes";
        internal const string MeanArgumentOfPeriapsisField = "mean_argument_of_periapsis";
        internal const string MeanPeriapsisDistanceField = "mean_periapsis_distance";
        internal const string MeanApoapsisDistanceField = "mean_apoapsis_distance";
        internal const string RadialDistanceField = "radial_distance";
        internal const string FirstCollisionTimeField = "first_collision_time";
        internal const string FirstCollisionRiskTimeField = "first_collision_risk_time";
        internal const string FirstReentryTimeField = "first_reentry_time";

        /// <summary>
        /// The element time series, which this Uplink reads nothing from and
        /// disposes anyway.
        ///
        /// <para>It arrives as an iterator over a native vector allocated on every
        /// call, and the marshaller's cleanup step is empty, so the only thing that
        /// ever frees one is the finaliser. The producer's own window eats that
        /// pressure every frame; a second reader on the same cadence need not.
        /// Disposing our copy cannot affect the producer's, because each call
        /// allocates its own.</para>
        /// </summary>
        internal const string PlottableElementsField = "plottable_elements";

        /// <summary>Fields on an interval.</summary>
        internal const string IntervalMinField = "min";
        internal const string IntervalMaxField = "max";

        /// <summary>Fields on the ground-track recurrence, which arrives on every
        /// analysis the producer could fit one for.</summary>
        internal const string RecurrenceField = "recurrence";
        internal const string RecurrenceCycleRotationsField = "cto";
        internal const string RecurrenceRevolutionsField = "number_of_revolutions";
        internal const string RecurrenceRevolutionsPerRotationField = "nuo";
        internal const string RecurrenceSubcycleField = "subcycle";
        internal const string RecurrenceEquatorialShiftField = "equatorial_shift";
        internal const string RecurrenceGridIntervalField = "grid_interval";

        /// <summary>Fields on the equatorial crossings, derived by the producer
        /// as a side effect of fitting the recurrence above.</summary>
        internal const string CrossingsField = "ground_track_equatorial_crossings";
        internal const string AscendingCrossingField = "longitudes_reduced_to_ascending_pass";
        internal const string DescendingCrossingField = "longitudes_reduced_to_descending_pass";

        /// <summary>Fields on the solar times of the nodes, present only when the
        /// producer had a mean sun.</summary>
        internal const string SolarTimesField = "solar_times_of_nodes";
        internal const string AscendingSolarTimeField = "mean_solar_times_of_ascending_nodes";
        internal const string DescendingSolarTimeField = "mean_solar_times_of_descending_nodes";

        private const double DegreesPerRadian = 180.0 / Math.PI;

        /// <summary>
        /// The hour a precession rate is quoted against.
        ///
        /// <para>An hour and not a day, though the producer's own window prints
        /// per day: a day is six hours under stock's Kerbin time, twenty-four with
        /// that setting off, and whatever Kopernicus says under a planet pack. An
        /// hour is an hour under all three, and a rate that means one of two
        /// things is worse than one a reader has to scale.</para>
        /// </summary>
        private const double SecondsPerHour = 3600.0;

        /// <summary>
        /// Every analysis for <paramref name="vesselGuid"/>, inside a frame the
        /// caller already opened.
        ///
        /// <para>Null when there is nothing to say: no vessel the producer knows,
        /// which is a different fact from a vessel with no analysis and no
        /// plan.</para>
        /// </summary>
        public AnalysisObservation? ReadInFrame(
            PrincipiaFrame frame,
            ICelestialNames celestials,
            string vesselGuid,
            double nowUt)
        {
            if (!frame.TryVessel(vesselGuid, out var vessel))
            {
                return null;
            }

            var observation = new AnalysisObservation
            {
                VesselId = vesselGuid,
                SampledAtUt = nowUt,
                // No epoch: the vessel analysis is anchored wherever the craft's
                // history ended when the producer last requested one, and the
                // producer publishes no instant for it. Saying so is the only
                // honest option, and a client renders it as an unknown age rather
                // than as a fresh reading.
                Orbit = Describe(vessel.OrbitAnalysis(FirstGroundTrackRevolution), celestials, null),
            };

            if (vessel.TryFlightPlan(out var plan))
            {
                ReadCoasts(plan, celestials, observation);
            }
            return observation;
        }

        /// <summary>
        /// The revolution the equatorial-crossing longitudes are reduced to.
        ///
        /// <para>One, which is what the producer's own analyser window passes. It
        /// indexes the two passes as <c>2n - 1</c> and <c>2n</c>, so the first
        /// revolution is 1 and NOT 0: zero asks for pass -1 and pass 0, which is
        /// not a revolution anybody flew.</para>
        ///
        /// <para>This used to be zero, on the recorded grounds that the value
        /// "does not matter" because the crossings came back absent regardless.
        /// They do not: the producer fits a recurrence itself and derives the
        /// crossings from it, whether or not a hypothesis is supplied.</para>
        /// </summary>
        private const int FirstGroundTrackRevolution = 1;

        /// <summary>
        /// One analysis per coast, bounded by the burn count read in this frame.
        ///
        /// <para>A plan with <c>n</c> burns has <c>n + 1</c> coasts: one before each
        /// burn and one after the last. The accessor answers null for an index it
        /// has no analysis for rather than aborting, which is why this can be a
        /// plain loop rather than a cursor.</para>
        /// </summary>
        private static void ReadCoasts(
            PrincipiaFlightPlanGate plan,
            ICelestialNames celestials,
            AnalysisObservation observation)
        {
            var cursor = plan.Manoeuvres();
            var starts = new double?[cursor.Count + 1];
            var ends = new double?[cursor.Count + 1];
            starts[0] = plan.InitialTime();
            ends[cursor.Count] = plan.DesiredFinalTime();

            foreach (var burn in cursor)
            {
                var manoeuvre = burn.Manoeuvre();
                if (manoeuvre == null)
                {
                    continue;
                }
                var inner = Fields.Get(manoeuvre, PrincipiaBurnStruct.ManoeuvreBurnField);
                // A coast ENDS where the next burn lights and BEGINS where the last
                // one cut off, so one burn dates the boundary on either side of it.
                ends[burn.Ordinal] = inner == null
                    ? null
                    : Fields.GetDouble(inner, PrincipiaBurnStruct.InitialTimeField);
                starts[burn.Ordinal + 1] =
                    Fields.GetDouble(manoeuvre, PrincipiaBurnStruct.ManoeuvreFinalTimeField);
            }

            for (var index = 0; index <= cursor.Count; index++)
            {
                observation.Coasts.Add(new CoastAnalysisObservation
                {
                    Index = index,
                    StartsAtUt = starts[index],
                    EndsAtUt = ends[index],
                    Analysis = Describe(
                        plan.CoastAnalysis(index, FirstGroundTrackRevolution),
                        celestials,
                        starts[index]),
                });
            }
        }

        /// <summary>
        /// One analysis struct, flattened, or null when there was none.
        ///
        /// <para><paramref name="epochUt"/> is passed in rather than found, because
        /// nothing on the struct carries it: a coast's analysis begins where the
        /// coast begins and only the caller knows that.</para>
        /// </summary>
        /// <summary>
        /// Copies the ground-track recurrence across, when the producer fitted one.
        ///
        /// <para>Reads a field on the analysis rather than on the elements: the
        /// recurrence describes the track, not the element set, and it is present
        /// on analyses whose elements are absent.</para>
        ///
        /// <para>Silence when there is no recurrence, and silence field by field:
        /// a trajectory the producer could not fit a repeating track to gets null
        /// rather than nought, because a nought-day cycle is a reading and not an
        /// absence.</para>
        /// </summary>
        private static void ReadRecurrence(object analysis, OrbitAnalysisObservation observation)
        {
            var recurrence = Fields.Get(analysis, RecurrenceField);
            if (recurrence == null)
            {
                return;
            }

            observation.RecurrenceCycleRotations = Fields.GetInt(recurrence, RecurrenceCycleRotationsField);
            observation.RecurrenceRevolutions =
                Fields.GetInt(recurrence, RecurrenceRevolutionsField);
            observation.RecurrenceRevolutionsPerRotation =
                Fields.GetInt(recurrence, RecurrenceRevolutionsPerRotationField);
            observation.RecurrenceSubcycleRotations =
                Fields.GetInt(recurrence, RecurrenceSubcycleField);
            observation.RecurrenceEquatorialShiftDegrees = Scale(
                Fields.GetDouble(recurrence, RecurrenceEquatorialShiftField),
                DegreesPerRadian);
            observation.RecurrenceGridIntervalDegrees = Scale(
                Fields.GetDouble(recurrence, RecurrenceGridIntervalField),
                DegreesPerRadian);
        }

        /// <summary>
        /// Copies the equatorial crossing bands across, in degrees.
        ///
        /// <para>Separate from the recurrence read beside it because they are
        /// separate fields on the analysis and either can be absent while the
        /// other is present: the producer derives the crossings only when it also
        /// has a ground track.</para>
        /// </summary>
        private static void ReadCrossings(object analysis, OrbitAnalysisObservation observation)
        {
            var crossings = Fields.Get(analysis, CrossingsField);
            if (crossings == null)
            {
                return;
            }

            observation.AscendingCrossingDegrees =
                Interval(crossings, AscendingCrossingField, DegreesPerRadian, 0.0);
            observation.DescendingCrossingDegrees =
                Interval(crossings, DescendingCrossingField, DegreesPerRadian, 0.0);
        }

        /// <summary>
        /// Copies the nodes' local mean solar times across, as angles in degrees
        /// with 180 at noon.
        ///
        /// <para>Kept as an angle rather than converted to a clock reading. That
        /// is the producer's own representation, it is what decides
        /// sun-synchronicity (the band's WIDTH, not its position), and turning it
        /// into hours here would put a duration's unit on something that is a time
        /// of day.</para>
        /// </summary>
        private static void ReadSolarTimes(object analysis, OrbitAnalysisObservation observation)
        {
            var solar = Fields.Get(analysis, SolarTimesField);
            if (solar == null)
            {
                return;
            }

            observation.AscendingNodeSolarTimeDegrees =
                Interval(solar, AscendingSolarTimeField, DegreesPerRadian, 0.0);
            observation.DescendingNodeSolarTimeDegrees =
                Interval(solar, DescendingSolarTimeField, DegreesPerRadian, 0.0);
        }

        internal static OrbitAnalysisObservation? Describe(
            object? analysis, ICelestialNames celestials, double? epochUt)
        {
            if (analysis == null)
            {
                return null;
            }

            var missionDuration = Fields.GetDouble(analysis, MissionDurationField);
            var primaryIndex = Fields.GetInt(analysis, PrimaryIndexField);
            var elements = Fields.Get(analysis, ElementsField);

            var observation = new OrbitAnalysisObservation
            {
                MissionDurationSeconds = missionDuration,
                ProgressOfNextAnalysis = Fields.GetDouble(analysis, ProgressField),
                PrimaryIndex = primaryIndex,
                PrimaryBody = primaryIndex == null ? null : celestials.NameOf(primaryIndex.Value),
                // A missing primary means unbound, but only once something else on
                // the struct has proved the struct is the shape we think it is.
                // Without that, a renamed field would report every craft escaping.
                GravitationallyBound = missionDuration == null ? null : primaryIndex != null,
                ElementsPresent = elements != null,
                ElementsEpochUt = epochUt,
            };

            ReadRecurrence(analysis, observation);
            ReadCrossings(analysis, observation);
            ReadSolarTimes(analysis, observation);

            if (elements == null)
            {
                return observation;
            }

            DisposePlottableElements(elements);

            var radius = primaryIndex == null ? null : celestials.RadiusOf(primaryIndex.Value);
            observation.SiderealPeriodSeconds = Fields.GetDouble(elements, SiderealPeriodField);
            observation.NodalPeriodSeconds = Fields.GetDouble(elements, NodalPeriodField);
            observation.AnomalisticPeriodSeconds =
                Fields.GetDouble(elements, AnomalisticPeriodField);
            observation.NodalPrecessionDegreesPerHour = Scale(
                Fields.GetDouble(elements, NodalPrecessionField),
                DegreesPerRadian * SecondsPerHour);

            observation.MeanSemimajorAxisMetres = Interval(elements, MeanSemimajorAxisField, 1.0, 0.0);
            observation.MeanEccentricity = Interval(elements, MeanEccentricityField, 1.0, 0.0);
            observation.MeanInclinationDegrees =
                Interval(elements, MeanInclinationField, DegreesPerRadian, 0.0);
            observation.MeanLongitudeOfAscendingNodeDegrees =
                Interval(elements, MeanLongitudeOfAscendingNodesField, DegreesPerRadian, 0.0);
            observation.MeanArgumentOfPeriapsisDegrees =
                Interval(elements, MeanArgumentOfPeriapsisField, DegreesPerRadian, 0.0);

            // Altitudes, not distances. The producer applies the primary's radius
            // in its own formatter, and a distance published under an altitude's
            // name is a number six hundred kilometres wrong that still looks
            // plausible. With no radius the pair goes out absent rather than as
            // distances wearing the wrong label.
            if (radius != null)
            {
                observation.MeanPeriapsisAltitudeMetres =
                    Interval(elements, MeanPeriapsisDistanceField, 1.0, -radius.Value);
                observation.MeanApoapsisAltitudeMetres =
                    Interval(elements, MeanApoapsisDistanceField, 1.0, -radius.Value);
                // The MINIMUM end alone, deliberately: this is the closest the craft
                // ever comes to the surface over the window, not an average of
                // anything, and it is the number an operator checks before leaving
                // a craft unattended.
                observation.LowestAltitudeMetres =
                    Interval(elements, RadialDistanceField, 1.0, -radius.Value)?.Min;
            }

            observation.FirstCollisionUt = Fields.GetDouble(elements, FirstCollisionTimeField);
            observation.FirstCollisionRiskUt =
                Fields.GetDouble(elements, FirstCollisionRiskTimeField);
            observation.FirstReentryUt = Fields.GetDouble(elements, FirstReentryTimeField);
            return observation;
        }

        private static IntervalObservation? Interval(
            object elements, string name, double scale, double offset)
        {
            var interval = Fields.Get(elements, name);
            if (interval == null)
            {
                return null;
            }
            var min = Fields.GetDouble(interval, IntervalMinField);
            var max = Fields.GetDouble(interval, IntervalMaxField);
            if (min == null && max == null)
            {
                return null;
            }
            return new IntervalObservation
            {
                Min = min == null ? null : min.Value * scale + offset,
                Max = max == null ? null : max.Value * scale + offset,
            };
        }

        private static double? Scale(double? value, double factor) =>
            value == null ? null : value.Value * factor;

        /// <summary>
        /// Frees the element time series this reading does not use.
        ///
        /// <para>Tolerant on purpose: a build that does not carry the field, or
        /// carries something that is not disposable, costs nothing here, and a
        /// throw from a third party's finaliser-backed handle must not take the
        /// tick with it.</para>
        /// </summary>
        private static void DisposePlottableElements(object elements)
        {
            try
            {
                if (Fields.Get(elements, PlottableElementsField) is IDisposable iterator)
                {
                    iterator.Dispose();
                }
            }
            catch (Exception)
            {
                // Nothing to report and nothing to do: the finaliser is still there.
            }
        }
    }
}
