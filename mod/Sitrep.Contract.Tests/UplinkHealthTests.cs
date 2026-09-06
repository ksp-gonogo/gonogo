using System.Collections.Generic;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Contract.Tests
{
    /// <summary>
    /// The three health states an Uplink can report, reached the same way.
    ///
    /// <para>Before the factories existed, <see cref="UplinkHealth.Healthy"/> was
    /// a value and the other two were a two-type incantation naming
    /// <see cref="UplinkHealthState"/> as well as <see cref="UplinkHealth"/>. An
    /// author who had only seen the healthy floor could not guess it, and the
    /// documentation had to spell the constructor out. These assert the reachable
    /// shape rather than the enum, which is what an Uplink author writes.</para>
    /// </summary>
    public class UplinkHealthTests
    {
        [Fact]
        public void HealthyCarriesNoDetailAndNoFacts()
        {
            var health = UplinkHealth.Healthy;

            Assert.Equal(UplinkHealthState.Healthy, health.State);
            Assert.Null(health.Detail);
            Assert.Empty(health.Facts);
        }

        [Fact]
        public void DegradedCarriesItsReason()
        {
            var health = UplinkHealth.Degraded("no CPU selected");

            Assert.Equal(UplinkHealthState.Degraded, health.State);
            Assert.Equal("no CPU selected", health.Detail);
            Assert.Empty(health.Facts);
        }

        [Fact]
        public void UnavailableCarriesItsReason()
        {
            var health = UplinkHealth.Unavailable("Example Mod is not installed");

            Assert.Equal(UplinkHealthState.Unavailable, health.State);
            Assert.Equal("Example Mod is not installed", health.Detail);
            Assert.Empty(health.Facts);
        }

        /// <summary>
        /// Facts stay optional on both, so the one-argument call an integration
        /// Uplink writes is not a lesser form of the API.
        /// </summary>
        [Fact]
        public void EitherFactoryCarriesFactsWhenGiven()
        {
            var facts = new List<UplinkHealthFact>
            {
                new UplinkHealthFact("binary", "1.2.3"),
            };

            Assert.Equal(facts, UplinkHealth.Degraded("stale", facts).Facts);
            Assert.Equal(facts, UplinkHealth.Unavailable("absent", facts).Facts);
        }

        /// <summary>
        /// The factories are the same values the constructor produced, so an
        /// existing Uplink that keeps writing the long form is not reporting
        /// something subtly different from one that adopted the short one.
        /// </summary>
        [Fact]
        public void FactoriesMatchTheConstructorTheyReplace()
        {
            var built = new UplinkHealth(UplinkHealthState.Unavailable, "absent");
            var made = UplinkHealth.Unavailable("absent");

            Assert.Equal(built.State, made.State);
            Assert.Equal(built.Detail, made.Detail);
            Assert.Equal(built.Facts, made.Facts);
        }
    }
}
