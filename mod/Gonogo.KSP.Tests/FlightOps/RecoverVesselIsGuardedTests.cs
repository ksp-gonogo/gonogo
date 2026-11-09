using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests.FlightOps
{
    /// <summary>
    /// <c>ksp.recoverVessel</c> recovers a vessel standing at the Space Center
    /// by id, read off the shipped source because
    /// <see cref="Gonogo.KSP.KspFlightOpsActuator"/> reaches <c>HighLogic</c>
    /// and <c>FlightGlobals</c> and none of it runs headlessly.
    /// </summary>
    public class RecoverVesselIsGuardedTests
    {
        private static string RecoverVesselBody() =>
            CurrencyDelaySourceText.MethodBody(
                CurrencyDelaySourceText.ReadRelative("KspFlightOpsActuator.cs"),
                "public CommandResult RecoverVessel(string vesselId)");

        [Fact]
        public void EveryRefusalComesBeforeTheRecoveryFires()
        {
            var body = RecoverVesselBody();

            var recover = body.IndexOf("ShipConstruction.RecoverVesselFromFlight(", System.StringComparison.Ordinal);
            Assert.True(recover >= 0, "the Space Center's own recovery call must be the one made");
            foreach (var guard in new[]
            {
                "scene != GameScenes.SPACECENTER",
                "CommandErrorCode.NotFound",
                "DiscoveryLevels.Owned",
                "found.IsRecoverable",
            })
            {
                var at = body.IndexOf(guard, System.StringComparison.Ordinal);
                Assert.True(at >= 0, "missing guard: " + guard);
                Assert.True(at < recover, guard + " must be checked before the recovery fires");
            }
        }

        [Fact]
        public void TheVesselIsLookedUpByIdNeverByTheActiveVessel()
        {
            var body = RecoverVesselBody();

            Assert.Contains("candidate.id.ToString()", body);
            Assert.DoesNotContain("ActiveVessel", body);
        }

        [Fact]
        public void TheSaveIsWrittenSoThePadReadsClear()
        {
            var body = RecoverVesselBody();

            var recover = body.IndexOf("ShipConstruction.RecoverVesselFromFlight(", System.StringComparison.Ordinal);
            var save = body.IndexOf("GamePersistence.SaveGame(", System.StringComparison.Ordinal);
            Assert.True(save > recover, "the save is written after the vessel has left the flight state");
        }

        [Fact]
        public void RecoverOnTheActiveVesselAsksTheGamesOwnRecoverabilityBeforeFiring()
        {
            var body = CurrencyDelaySourceText.MethodBody(
                CurrencyDelaySourceText.ReadRelative("KspFlightOpsActuator.cs"),
                "public CommandResult Recover()");

            var fire = body.IndexOf("OnVesselRecoveryRequested.Fire(", System.StringComparison.Ordinal);
            var guard = body.IndexOf("IsRecoverable", System.StringComparison.Ordinal);
            Assert.True(guard >= 0, "an orbiting craft passes ClearToSave, so the vessel's own IsRecoverable must be asked");
            Assert.True(guard < fire, "IsRecoverable must be checked before the recovery fires");
        }

        [Fact]
        public void TheRecoverControlIsGatedOnTheVesselsOwnRecoverability()
        {
            var declarations = CurrencyDelaySourceText.ReadRelative("Gates/GateDeclarations.cs");
            var at = declarations.IndexOf("table[FlightOpsCommandProvider.RecoverCommand]", System.StringComparison.Ordinal);
            Assert.True(at >= 0);
            var end = declarations.IndexOf("};", at, System.StringComparison.Ordinal);
            Assert.Contains("CareerGates.Recoverable", declarations.Substring(at, end - at));
        }
    }
}
