using System.Collections.Generic;
using Xunit;

namespace GonogoPrincipiaUplink.Tests
{
    /// <summary>
    /// Drives the reflection walk against stand-ins that mirror the integrator's own
    /// member names, character for character.
    ///
    /// <para>This is the only way to test a reflection reader honestly without the
    /// third-party assembly present, and it is a real test rather than a tautology
    /// for one reason: <b>the stand-ins spell the names the way the integrator spells
    /// them</b>, including the ligature in <c>manœuvre</c> and the delta in
    /// <c>Δv</c>. A typo in a name constant fails here. What it cannot catch is the
    /// integrator RENAMING something, and nothing local can; that is what the
    /// per-read tolerance and the version-stamped observation are for.</para>
    ///
    /// <para>The stand-ins also mirror the SHAPES that matter: private fields on a
    /// base class (which <c>BindingFlags.NonPublic</c> does not inherit), a
    /// nullable-int field, the plan end behind a slider-like object rather than as a
    /// double, and the Δv behind a method rather than a field.</para>
    /// </summary>
    public class FlightPlanReflectionTests
    {
        [Fact]
        public void ReadsThePlanAndItsBurnsOffAStandInPlanner()
        {
            var planner = FakePlanner.WithTwoBurns();

            var observation = new FlightPlanReflection().Read(planner, "guid-1", 500.0, planExists: true);

            Assert.Equal("guid-1", observation.VesselId);
            Assert.Equal(500.0, observation.ObservedAtUt);
            Assert.True(observation.PlanExists);
            Assert.True(observation.ReachedDeadline);
            Assert.Equal(9_000.0, observation.FinalTimeUt);
            Assert.Equal(1, observation.FirstFutureBurnIndex);
            Assert.Equal(2, observation.Burns.Count);

            var second = observation.Burns[1];
            Assert.Equal(1, second.Index);
            Assert.Equal(3_000.0, second.IgnitionUt);
            Assert.Equal(3_120.0, second.CutoffUt);
            Assert.Equal(120.0, second.DurationSeconds);
            Assert.Equal(5.0, second.DeltaV);
            Assert.Equal(60.0, second.ThrustKilonewtons);
            Assert.Equal(310.0, second.SpecificImpulseSeconds);
            Assert.Equal(4.5, second.InitialMassTons);
            Assert.True(second.InertiallyFixed);
            Assert.Equal(2, second.CoordinateSystem);
        }

        /// <summary>
        /// The planner's own hierarchy has several layers and its fields are private,
        /// so a reader that did not walk the base chain by hand would silently read
        /// nothing: <c>BindingFlags.NonPublic</c> does not inherit.
        /// </summary>
        [Fact]
        public void FindsAPrivateFieldDeclaredOnABaseClass()
        {
            var planner = FakePlanner.WithTwoBurns();

            var observation = new FlightPlanReflection().Read(planner, "g", 0.0, planExists: true);

            Assert.Equal(1, observation.AnomalousBurnCount);
        }

        /// <summary>
        /// An unreadable status must leave the verdict UNKNOWN. Reporting
        /// "integrated" from a failed read would put health on the one field that
        /// decides whether the plan is worth trusting, which is the failure this
        /// whole channel exists to prevent.
        /// </summary>
        [Fact]
        public void AStatusItCannotReadIsUnknownRatherThanFine()
        {
            var planner = new PlannerWithoutStatus();

            var observation = new FlightPlanReflection().Read(planner, "g", 0.0, planExists: true);

            Assert.Null(observation.PlanIntegrated);
            Assert.Null(observation.StatusError);
        }

        [Fact]
        public void PrefersTheIntegratorsOwnOkPredicateOverGuessingAtTheCode()
        {
            // ok() says false while the code is 0, so a reader comparing the code
            // against zero would call this plan healthy. The predicate is the
            // definition; the code convention is an assumption.
            var planner = FakePlanner.WithStatus(error: 0, message: "diverged", ok: false);

            var observation = new FlightPlanReflection().Read(planner, "g", 0.0, planExists: true);

            Assert.False(observation.PlanIntegrated);
            Assert.Equal(0, observation.StatusError);
            Assert.Equal("diverged", observation.StatusMessage);
        }

        /// <summary>
        /// A failed plan names the burn that broke it. "The plan failed" and "burn 3
        /// failed" ask different things of an operator, and only the second is
        /// actionable.
        /// </summary>
        [Fact]
        public void NamesTheBurnThatBrokeTheIntegration()
        {
            var planner = FakePlanner.WithStatus(error: 7, message: "out of range", ok: false);

            var observation = new FlightPlanReflection().Read(planner, "g", 0.0, planExists: true);

            Assert.Equal(2, observation.FirstErrorBurnIndex);
        }

        [Fact]
        public void AnOkPlanCarriesNoErrorOrMessage()
        {
            var planner = FakePlanner.WithStatus(error: 0, message: "ignored when ok", ok: true);

            var observation = new FlightPlanReflection().Read(planner, "g", 0.0, planExists: true);

            Assert.True(observation.PlanIntegrated);
            Assert.Null(observation.StatusError);
            Assert.Null(observation.StatusMessage);
        }

        /// <summary>
        /// A non-finite double is dropped rather than passed on. An infinite ignition
        /// instant would render as a countdown to never, which reads as a real
        /// answer.
        /// </summary>
        [Fact]
        public void DropsNonFiniteNumbersRatherThanPublishingThem()
        {
            var planner = FakePlanner.WithBurn(new FakeBurnEditor
            {
                initial_time_ = double.NaN,
                duration_ = double.PositiveInfinity,
            });

            var observation = new FlightPlanReflection().Read(planner, "g", 0.0, planExists: true);

            Assert.Null(observation.Burns[0].IgnitionUt);
            Assert.Null(observation.Burns[0].DurationSeconds);
        }

        /// <summary>
        /// Nothing about a planner shape is guaranteed by a version the guard does
        /// not gate on, so a shape it cannot read at all must degrade to an empty
        /// observation instead of throwing inside someone else's render.
        /// </summary>
        [Fact]
        public void AnUnrecognisableShapeYieldsAnEmptyObservationRatherThanThrowing()
        {
            var observation = new FlightPlanReflection().Read(new object(), "g", 12.0, planExists: true);

            Assert.Equal(12.0, observation.ObservedAtUt);
            Assert.Empty(observation.Burns);
            Assert.Null(observation.PlanIntegrated);
            Assert.Null(observation.FinalTimeUt);
            Assert.Equal(0, observation.AnomalousBurnCount);
        }

        [Fact]
        public void ReadsThePredictedVesselIdThroughTheVesselObject()
        {
            var planner = FakePlanner.WithTwoBurns();

            Assert.Equal("vessel-guid", new FlightPlanReflection().PredictedVesselId(planner));
        }

        [Fact]
        public void NoPredictedVesselIsNullRatherThanAnEmptyString()
        {
            Assert.Null(new FlightPlanReflection().PredictedVesselId(new PlannerWithoutStatus()));
        }
    }

    /// <summary>Where the integrator declares its anomalous count on a base class,
    /// so the reader has to walk the chain to find it.</summary>
    public class FakePlannerBase
    {
#pragma warning disable CS0414, IDE0044, IDE1006
        private int number_of_anomalous_manœuvres_ = 1;
#pragma warning restore CS0414, IDE0044, IDE1006
    }

    /// <summary>Mirrors the planner's member names exactly. Field names, not
    /// properties, where the integrator uses fields.</summary>
    public class FakePlanner : FakePlannerBase
    {
#pragma warning disable CS0414, IDE0044, IDE1006
        private bool reached_deadline_ = true;
        private object? status_ = new FakeStatus();
        private int? first_error_manœuvre_;
        private int? first_future_manœuvre_ = 1;
        private object? final_time_ = new FakeSlider { value = 9_000.0 };
        private object? burn_editors_;
        private object? predicted_vessel = new FakeVessel();
#pragma warning restore CS0414, IDE0044, IDE1006

        public static FakePlanner WithTwoBurns() =>
            new FakePlanner
            {
                burn_editors_ = new List<object>
                {
                    new FakeBurnEditor { initial_time_ = 1_000.0, duration_ = 60.0 },
                    new FakeBurnEditor
                    {
                        initial_time_ = 3_000.0,
                        duration_ = 120.0,
                        deltaV = 5.0,
                        thrust_in_kilonewtons_ = 60.0,
                        specific_impulse_in_seconds_g0_ = 310.0,
                        initial_mass_in_tonnes_ = 4.5,
                        is_inertially_fixed_ = true,
                        coordinate_system_ = 2,
                    },
                },
            };

        public static FakePlanner WithBurn(FakeBurnEditor burn) =>
            new FakePlanner { burn_editors_ = new List<object> { burn } };

        public static FakePlanner WithStatus(int error, string message, bool ok) =>
            new FakePlanner
            {
                status_ = new FakeStatus { error = error, message = message, isOk = ok },
                burn_editors_ = new List<object>(),
                first_error_manœuvre_ = 2,
            };
    }

    /// <summary>A planner-shaped object with no status and no vessel, for the cases
    /// that must degrade rather than assume.</summary>
    public class PlannerWithoutStatus
    {
#pragma warning disable CS0414, IDE0044, IDE1006
        // Read by reflection, never in code: the compiler cannot see that, hence
        // the suppression. It is here so this fixture is a planner MISSING a status
        // rather than a planner missing everything.
        private bool reached_deadline_ = false;
        private object? burn_editors_ = new List<object>();
#pragma warning restore CS0414, CS0169, IDE0044, IDE1006
    }

    public class FakeSlider
    {
#pragma warning disable IDE1006
        public double value { get; set; }
#pragma warning restore IDE1006
    }

    /// <summary>Fields, not properties, because that is what the game's vessel
    /// carries. A double that presented a property here would exercise the
    /// property-audit path for a read that never takes it in production, and pass
    /// on a member the guard would never have been asked about.</summary>
    public class FakeVessel
    {
#pragma warning disable IDE1006
        public object id = "vessel-guid";
        public string vesselName = "Munar Relay";
#pragma warning restore IDE1006
    }

    /// <summary>The integrator's status: two public fields and its own health
    /// predicate, as on the real one.</summary>
    public class FakeStatus
    {
#pragma warning disable IDE1006
        public int error;
        public string message = "";
        internal bool isOk = true;

        public bool ok() => isOk;
#pragma warning restore IDE1006
    }

    /// <summary>Mirrors the burn editor: ignition and cutoff as properties over
    /// fields, Δv as a method, the rest as fields.
    ///
    /// <para>The fields are <c>internal</c> rather than <c>private</c> only so the
    /// fixtures above can set them. Internal is still non-public, so the reader
    /// resolves them through the same <c>NonPublic</c> path it uses on the real
    /// type.</para></summary>
    public class FakeBurnEditor
    {
#pragma warning disable IDE1006
        internal double initial_time_;
        internal double duration_;
        internal double deltaV;
        internal double thrust_in_kilonewtons_;
        internal double specific_impulse_in_seconds_g0_;
        internal double initial_mass_in_tonnes_;
        internal bool is_inertially_fixed_;
        internal int? coordinate_system_;

        public double initial_time => initial_time_;
        public double final_time => initial_time_ + duration_;

        public double Δv() => deltaV;
#pragma warning restore IDE1006
    }
}
