using FerramAerospaceResearch.FARAeroComponents;
using FerramAerospaceResearch.FARGUI.FARFlightGUI;
using Xunit;

namespace GonogoFerramAerospaceResearchUplink.Tests
{
    /// <summary>
    /// The reflection walk, exercised headless against the stand-in FAR graph in
    /// <c>FarFixture.cs</c>. This is the layer that would otherwise only be
    /// testable in a running game, and it is where a FAR rename lands, so it is
    /// worth the fixture.
    /// </summary>
    public class AeroReflectionTests
    {
        private static FakeVessel VesselWith(params object[] modules)
        {
            var vessel = new FakeVessel();
            vessel.vesselModules.AddRange(modules);
            return vessel;
        }

        private static FlightGUI FlightGuiHolding(VesselFlightInfo info, AirspeedSettingsGUI? airspeed = null) =>
            new FlightGUI { InfoParameters = info, airSpeedGUI = airspeed };

        [Fact]
        public void TheProbeResolvesFarsTypesAndMembers()
        {
            var far = new AeroReflection();

            Assert.True(far.IsAvailable);
            Assert.True(far.AirspeedAvailable);
            Assert.True(far.VoxelizationAvailable);
        }

        [Fact]
        public void EveryFieldTheWireCarriesIsReadOffTheFlightInfoStruct()
        {
            var info = new VesselFlightInfo
            {
                aoA = 3.5,
                sideslipAngle = -1.25,
                stallFraction = 0.2,
                liftCoeff = 0.44,
                dragCoeff = 0.08,
                liftToDragRatio = 5.5,
                refArea = 21.0,
                liftForce = 70.0,
                dragForce = 12.7,
                dynPres = 9.5,
                termVelEst = 290.0,
                ballisticCoeff = 380.0,
                specExcessPower = 31.5,
            };
            var vessel = VesselWith(
                FlightGuiHolding(info, new AirspeedSettingsGUI { Ias = 155.0, Eas = 151.0 }),
                new FARVesselAero { Valid = true });

            var raw = new AeroReflection().Read(vessel, ut: 42.0);

            Assert.NotNull(raw);
            Assert.Equal(42.0, raw!.Ut);
            Assert.Equal(3.5, raw.AngleOfAttackDeg);
            Assert.Equal(-1.25, raw.SideslipDeg);
            Assert.Equal(0.2, raw.StallFraction);
            Assert.Equal(0.44, raw.LiftCoefficient);
            Assert.Equal(0.08, raw.DragCoefficient);
            Assert.Equal(5.5, raw.LiftToDragRatio);
            Assert.Equal(21.0, raw.ReferenceAreaSqM);
            Assert.Equal(70.0, raw.LiftForceKn);
            Assert.Equal(12.7, raw.DragForceKn);
            Assert.Equal(9.5, raw.DynamicPressureKpa);
            Assert.Equal(290.0, raw.TerminalVelocity);
            Assert.Equal(380.0, raw.BallisticCoefficient);
            Assert.Equal(31.5, raw.SpecificExcessPower);
            Assert.Equal(155.0, raw.IndicatedAirspeed);
            Assert.Equal(151.0, raw.EquivalentAirspeed);
            Assert.True(raw.AeroModelValid);
        }

        /// <summary>
        /// A vessel FAR is not tracking. Every scalar helper on FAR's own API
        /// answers this case with 0.0, which is what this Uplink exists not to
        /// repeat: nothing is published rather than a vessel-shaped set of zeros.
        /// </summary>
        [Fact]
        public void AVesselWithNoFlightInformationReadsAsNothingRatherThanZeros()
        {
            Assert.Null(new AeroReflection().Read(VesselWith(), ut: 1.0));
        }

        [Fact]
        public void NoVesselReadsAsNothing()
        {
            Assert.Null(new AeroReflection().Read(null, ut: 1.0));
        }

        /// <summary>
        /// FAR only builds the airspeed helper once a vessel's aero modules have
        /// been handed over, and nulls it again on teardown, so it is genuinely
        /// absent for stretches of a normal flight. The rest of the reading has to
        /// survive that.
        /// </summary>
        [Fact]
        public void AMissingAirspeedHelperCostsTheTwoAirspeedsAndNothingElse()
        {
            var vessel = VesselWith(FlightGuiHolding(new VesselFlightInfo { aoA = 6.0, dynPres = 5.0 }));

            var raw = new AeroReflection().Read(vessel, ut: 7.0);

            Assert.NotNull(raw);
            Assert.True(double.IsNaN(raw!.IndicatedAirspeed));
            Assert.True(double.IsNaN(raw.EquivalentAirspeed));
            Assert.Equal(6.0, raw.AngleOfAttackDeg);

            // and the pair reaches the wire as absence rather than as a number
            var payload = AeroCapture.Build(raw);
            Assert.NotNull(payload);
            Assert.Null(payload!["indicatedAirspeed"]);
            Assert.Null(payload["equivalentAirspeed"]);
        }

        /// <summary>
        /// The qualifier reads false when it cannot be confirmed, not absent: an
        /// operator's response to "the aerodynamic model may not have caught up"
        /// is the same either way, and a nullable third state would only invite a
        /// widget to treat unknown as fine.
        /// </summary>
        [Fact]
        public void AVesselWithNoAeroModuleIsReportedAsNotCurrentlyVoxelised()
        {
            var vessel = VesselWith(FlightGuiHolding(new VesselFlightInfo { dynPres = 5.0 }));

            Assert.False(new AeroReflection().Read(vessel, ut: 1.0)!.AeroModelValid);
        }

        [Fact]
        public void AQueuedVoxelisationIsReportedAsNotCurrent()
        {
            var vessel = VesselWith(
                FlightGuiHolding(new VesselFlightInfo { dynPres = 5.0 }),
                new FARVesselAero { Valid = false });

            Assert.False(new AeroReflection().Read(vessel, ut: 1.0)!.AeroModelValid);
        }

        /// <summary>
        /// The walk finds its modules by type among whatever else the vessel is
        /// carrying, the way it does in a game where every vessel holds a dozen
        /// unrelated modules.
        /// </summary>
        [Fact]
        public void TheModulesAreFoundAmongUnrelatedOnes()
        {
            var vessel = VesselWith(
                new object(),
                "an unrelated module",
                FlightGuiHolding(new VesselFlightInfo { aoA = 2.0, dynPres = 5.0 }),
                new object(),
                new FARVesselAero { Valid = true });

            var raw = new AeroReflection().Read(vessel, ut: 1.0);

            Assert.Equal(2.0, raw!.AngleOfAttackDeg);
            Assert.True(raw.AeroModelValid);
        }

        /// <summary>
        /// A vessel type with no module list at all, which is what a KSP rename of
        /// <c>vesselModules</c> would look like from here. It degrades to absence
        /// rather than throwing, because a capture that throws takes its owning
        /// Uplink inert from the next tick.
        /// </summary>
        [Fact]
        public void AVesselWithNoModuleListDegradesToAbsence()
        {
            Assert.Null(new AeroReflection().Read(new object(), ut: 1.0));
        }
    }
}
