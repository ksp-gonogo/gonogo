using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests.FlightOps
{
    /// <summary>
    /// <c>ksp.switchVessel</c> refuses outside the flight scene before it
    /// touches the game, read off the shipped source because
    /// <see cref="Gonogo.KSP.KspFlightOpsActuator"/> reaches
    /// <c>HighLogic</c> and <c>FlightGlobals</c> and none of it runs headlessly.
    ///
    /// <para>From the space centre, <c>FlightGlobals.SetActiveVessel</c> threw
    /// partway through and left the craft landed yet moving over the ground at
    /// 175 m/s with an orbital speed of zero, a state the game never produces
    /// on its own.</para>
    /// </summary>
    public class SwitchVesselIsSceneGatedTests
    {
        private static string SwitchVesselBody() =>
            CurrencyDelaySourceText.MethodBody(
                CurrencyDelaySourceText.ReadRelative("KspFlightOpsActuator.cs"),
                "public CommandResult SwitchVessel(string vesselId)");

        [Fact]
        public void TheSceneIsCheckedBeforeTheSwitchIsAttempted()
        {
            var body = SwitchVesselBody();

            var gate = body.IndexOf("if (!HighLogic.LoadedSceneIsFlight)", System.StringComparison.Ordinal);
            var roster = body.IndexOf("FlightGlobals.Vessels", System.StringComparison.Ordinal);
            var call = body.IndexOf("FlightGlobals.SetActiveVessel(", System.StringComparison.Ordinal);

            Assert.True(gate >= 0, "SwitchVessel must refuse outside the flight scene");
            Assert.True(call >= 0);
            Assert.True(gate < roster && gate < call, "the scene gate must come before anything reads or moves a vessel");
        }

        /// <summary>
        /// The same refusal <c>Launch</c> gives from the wrong scene, so a client
        /// renders both with one sentence.
        /// </summary>
        [Fact]
        public void TheRefusalIsWrongSceneAndNamesTheScene()
        {
            var body = SwitchVesselBody();

            Assert.Contains(
                "CommandErrorCode.WrongScene, $\"the game is in the {GameWords.Phrase(HighLogic.LoadedScene)} scene\"",
                body);
        }
    }
}
