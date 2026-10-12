using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Contract.TestSupport;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    public class LaunchAuthorityGateTests
    {
        private const string Ksc = "ground:KSC";

        private sealed class Site : IGateArguments
        {
            private readonly Dictionary<string, object> _values = new Dictionary<string, object>();

            public Site(string site) => _values["site"] = site;

            public bool TryGet(string path, out object value) => _values.TryGetValue(path, out value!);
        }

        private static GateVerdict Judge(FakeFlightOpsActuator actuator, string vantage, string site = "LaunchPad") =>
            new LaunchAuthorityGate(actuator.ReachOf).Evaluate(LaunchAuthorityGate.Requirement(), new Site(site), vantage);

        [Fact]
        public void TheRequirementNeedsTheSiteAndTheSender()
        {
            var requirement = LaunchAuthorityGate.Requirement();

            Assert.Equal(LaunchAuthorityGate.GateKind, requirement.Kind);
            Assert.Equal(new[] { "site" }, requirement.Needs);
            Assert.True(requirement.NeedsVantage);
        }

        [Fact]
        public void TheGateMeetsWhatAVantageEvaluatorOwesTheHost()
        {
            var verdict = VantageGateConformance.AssertAnswersForItsVantage(
                new LaunchAuthorityGate(new FakeFlightOpsActuator().ReachOf), LaunchAuthorityGate.Requirement(), Ksc);

            Assert.Equal(GateOutcome.Pass, verdict.Outcome);
        }

        [Fact]
        public void ACentreInThePadsSystemPassesAndIsAskedWithTheVantage()
        {
            var actuator = new FakeFlightOpsActuator();

            var verdict = Judge(actuator, Ksc, "Runway");

            Assert.Equal(GateOutcome.Pass, verdict.Outcome);
            Assert.Equal(Ksc, actuator.LastReachVantage);
        }

        [Fact]
        public void ACentreOnAnotherWorldFailsOutOfReachNamingBothSystems()
        {
            var actuator = new FakeFlightOpsActuator
            {
                Reach = new LaunchReach
                {
                    CentreName = "Duna Base",
                    SiteName = "Launch Pad",
                    CentreSystem = new SystemRoot(6, "Duna", isStar: false),
                    SiteSystem = new SystemRoot(1, "Kerbin", isStar: false),
                },
            };

            var verdict = Judge(actuator, "vessel:duna-base");

            Assert.Equal(GateOutcome.Fail, verdict.Outcome);
            Assert.Equal(CommandErrorCode.OutOfReach, verdict.ErrorCode);
            Assert.Contains("Duna", verdict.Detail);
            Assert.Contains("Kerbin", verdict.Detail);
        }

        [Fact]
        public void ASaveWithNoActiveCentrePassesWithoutReadingTheGame()
        {
            var actuator = new FakeFlightOpsActuator();

            var verdict = Judge(actuator, "");

            Assert.Equal(GateOutcome.Pass, verdict.Outcome);
            Assert.Equal(0, actuator.ReachOfCallCount);
        }

        [Fact]
        public void ASystemThatCannotBeReadIsUnknownNotARefusal()
        {
            var actuator = new FakeFlightOpsActuator
            {
                Reach = new LaunchReach { CentreName = "KSC", SiteName = "Launch Pad", CentreSystem = null, SiteSystem = null },
            };

            var verdict = Judge(actuator, Ksc);

            Assert.Equal(GateOutcome.Unknown, verdict.Outcome);
        }
    }
}
