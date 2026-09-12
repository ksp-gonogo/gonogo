using System.Collections.Generic;
using System.Globalization;
using System.Threading;
using Gonogo.RealAntennasUplink;
using Xunit;

namespace GonogoRealAntennasUplink.Tests
{
    /// <summary>
    /// The chain's save round-trip, through a real <c>ConfigNode</c>.
    ///
    /// <para>It is the half that makes a chain intent rather than a session
    /// setting: an operator who armed one before logging off has every right to
    /// find it still armed, and without this the antenna would come back sitting
    /// on whatever entry the walk last reached with nothing left to move it.</para>
    /// </summary>
    public class RaChainPersistenceTests
    {
        private static RealAntennasTargetStepArgs Surface(double latitude, double longitude, double altitude) =>
            new RealAntennasTargetStepArgs
            {
                Mode = "BodyLatLonAlt",
                BodyName = "Mun",
                Latitude = latitude,
                Longitude = longitude,
                Altitude = altitude,
            };

        [Fact]
        public void AChainSurvivesASaveAndALoad()
        {
            var saved = new RaChainRegister();
            saved.Set(
                "1234/0",
                new List<RealAntennasTargetStepArgs>
                {
                    new RealAntennasTargetStepArgs { Mode = "BodyCenter" },
                    Surface(-0.5, 121.25, 1500.0),
                    new RealAntennasTargetStepArgs { Mode = "Vessel", VesselId = "abc" },
                },
                45.0);
            RaChainPolicy.RecordApplied(saved.Find("1234/0")!.Walk, 1, 3, 900.0);

            var node = new ConfigNode();
            RaChainPersistence.Save(saved, node);
            var loaded = new RaChainRegister();
            RaChainPersistence.Load(loaded, node);

            var entry = loaded.Find("1234/0");
            Assert.NotNull(entry);
            Assert.Equal(3, entry!.Steps.Count);
            Assert.Equal("BodyCenter", entry.Steps[0].Mode);
            Assert.Equal("Mun", entry.Steps[1].BodyName);
            Assert.Equal(-0.5, entry.Steps[1].Latitude);
            Assert.Equal(121.25, entry.Steps[1].Longitude);
            Assert.Equal(1500.0, entry.Steps[1].Altitude);
            Assert.Equal("abc", entry.Steps[2].VesselId);
            Assert.Equal(45.0, entry.SettleSeconds);
        }

        /// <summary>
        /// The walk position goes in the save with the chain. Without it a reload
        /// during an outage would restart at the preferred target, which is the
        /// one already known not to be working, and would get there by slewing off
        /// whichever entry the craft had just settled on.
        /// </summary>
        [Fact]
        public void TheWalkPositionSurvivesTheRoundTrip()
        {
            var saved = new RaChainRegister();
            saved.Set("1234/0", new List<RealAntennasTargetStepArgs>
            {
                new RealAntennasTargetStepArgs { Mode = "BodyCenter" },
                new RealAntennasTargetStepArgs { Mode = "AzEl", Azimuth = 90.0, Elevation = 10.0 },
            }, null);
            var walk = saved.Find("1234/0")!.Walk;
            RaChainPolicy.RecordApplied(walk, 1, 2, 1234.5);
            walk.Laps = 2;

            var node = new ConfigNode();
            RaChainPersistence.Save(saved, node);
            var loaded = new RaChainRegister();
            RaChainPersistence.Load(loaded, node);

            var restored = loaded.Find("1234/0")!.Walk;
            Assert.Equal(1, restored.ActiveStep);
            Assert.Equal(1234.5, restored.LastAppliedUt);
            Assert.Equal(2, restored.Laps);
        }

        /// <summary>
        /// A field the entry's mode does not read comes back ABSENT, not zero. A
        /// zero latitude is a specific place nobody asked for, and the plan
        /// refuses an absent one rather than aiming at it.
        /// </summary>
        [Fact]
        public void AFieldTheModeDoesNotReadComesBackAbsentRatherThanZero()
        {
            var saved = new RaChainRegister();
            saved.Set("1234/0", new List<RealAntennasTargetStepArgs>
            {
                new RealAntennasTargetStepArgs { Mode = "BodyCenter" },
            }, null);

            var node = new ConfigNode();
            RaChainPersistence.Save(saved, node);
            var loaded = new RaChainRegister();
            RaChainPersistence.Load(loaded, node);

            var step = loaded.Find("1234/0")!.Steps[0];
            Assert.Null(step.Latitude);
            Assert.Null(step.Longitude);
            Assert.Null(step.Azimuth);
            Assert.Null(step.VesselId);
        }

        /// <summary>
        /// A save from before this existed, or a new game, has no node at all and
        /// the register is left as it was rather than cleared.
        /// </summary>
        [Fact]
        public void ASaveWithNoChainNodeLeavesTheRegisterAlone()
        {
            var register = new RaChainRegister();
            register.Set("1234/0", new List<RealAntennasTargetStepArgs>
            {
                new RealAntennasTargetStepArgs { Mode = "BodyCenter" },
            }, null);

            RaChainPersistence.Load(register, new ConfigNode());

            Assert.NotNull(register.Find("1234/0"));
        }

        /// <summary>
        /// Written in invariant culture, whatever the machine's own is. A comma
        /// decimal separator would turn one coordinate into two values and the
        /// entry would load pointing somewhere else entirely, which is the same
        /// hazard the target node itself carries.
        /// </summary>
        [Fact]
        public void CoordinatesRoundTripUnderACommaDecimalCulture()
        {
            var original = Thread.CurrentThread.CurrentCulture;
            Thread.CurrentThread.CurrentCulture = new CultureInfo("de-DE");
            try
            {
                var saved = new RaChainRegister();
                saved.Set("1234/0", new List<RealAntennasTargetStepArgs> { Surface(12.5, -60.25, 3.75) }, 22.5);

                var node = new ConfigNode();
                RaChainPersistence.Save(saved, node);
                var loaded = new RaChainRegister();
                RaChainPersistence.Load(loaded, node);

                var step = loaded.Find("1234/0")!.Steps[0];
                Assert.Equal(12.5, step.Latitude);
                Assert.Equal(-60.25, step.Longitude);
                Assert.Equal(3.75, step.Altitude);
                Assert.Equal(22.5, loaded.Find("1234/0")!.SettleSeconds);
            }
            finally
            {
                Thread.CurrentThread.CurrentCulture = original;
            }
        }

        /// <summary>
        /// One unparseable chain is skipped and the rest load. The cost of
        /// dropping one is that one antenna stops falling back; the cost of
        /// throwing is the module's whole OnLoad, which would take every other
        /// chain with it.
        /// </summary>
        [Fact]
        public void AChainWithNoAddressIsSkippedAndItsNeighboursStillLoad()
        {
            var saved = new RaChainRegister();
            saved.Set("1234/0", new List<RealAntennasTargetStepArgs>
            {
                new RealAntennasTargetStepArgs { Mode = "BodyCenter" },
            }, null);
            var node = new ConfigNode();
            RaChainPersistence.Save(saved, node);
            var orphan = node.GetNode("REALANTENNAS_TARGET_CHAINS").AddNode("CHAIN");
            orphan.AddNode("STEP").AddValue("mode", "BodyCenter");

            var loaded = new RaChainRegister();
            RaChainPersistence.Load(loaded, node);

            Assert.Equal(1, loaded.Count);
            Assert.NotNull(loaded.Find("1234/0"));
        }
    }
}
