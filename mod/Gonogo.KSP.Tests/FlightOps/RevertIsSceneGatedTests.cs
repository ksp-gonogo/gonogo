using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests.FlightOps
{
    /// <summary>
    /// <c>ksp.revertToLaunch</c> and <c>ksp.revertToEditor</c> refuse outside
    /// the flight scene before they read any <c>FlightDriver</c> state, read off
    /// the shipped source because <see cref="Gonogo.KSP.KspFlightOpsActuator"/>
    /// reaches <c>HighLogic</c> and <c>FlightDriver</c> and none of it runs
    /// headlessly.
    ///
    /// <para><c>FlightDriver.OnDestroy</c> clears neither
    /// <c>CanRevertToPostInit</c> nor <c>CanRevertToPrelaunch</c>, so from the
    /// space centre after a flight both can still read true, and the reverts
    /// behind them dereference <c>FlightStateCache</c>, <c>PostInitState</c> and
    /// <c>PreLaunchState</c> left over from that flight.</para>
    /// </summary>
    public class RevertIsSceneGatedTests
    {
        private const string SceneGate = "if (!HighLogic.LoadedSceneIsFlight)";

        private const string WrongSceneRefusal =
            "CommandErrorCode.WrongScene, $\"the game is in the {GameWords.Phrase(HighLogic.LoadedScene)} scene\"";

        private static string Body(string signature) =>
            CurrencyDelaySourceText.MethodBody(
                CurrencyDelaySourceText.ReadRelative("KspFlightOpsActuator.cs"),
                signature);

        private static string RevertToLaunchBody() => Body("public CommandResult RevertToLaunch()");

        private static string RevertToEditorBody() =>
            Body("public CommandResult RevertToEditor(EditorFacilityKind facility)");

        [Fact]
        public void RevertToLaunchChecksTheSceneBeforeReadingAnyFlightDriverState()
        {
            var body = RevertToLaunchBody();

            var gate = body.IndexOf(SceneGate, System.StringComparison.Ordinal);
            var flag = body.IndexOf("FlightDriver.CanRevertToPostInit", System.StringComparison.Ordinal);
            var call = body.IndexOf("FlightDriver.RevertToLaunch(", System.StringComparison.Ordinal);

            Assert.True(gate >= 0, "RevertToLaunch must refuse outside the flight scene");
            Assert.True(flag >= 0 && call >= 0);
            Assert.True(gate < flag && gate < call, "the scene gate must come before the revert flag is read");
        }

        [Fact]
        public void RevertToEditorChecksTheSceneBeforeReadingAnyFlightDriverState()
        {
            var body = RevertToEditorBody();

            var gate = body.IndexOf(SceneGate, System.StringComparison.Ordinal);
            var flag = body.IndexOf("FlightDriver.CanRevertToPrelaunch", System.StringComparison.Ordinal);
            var call = body.IndexOf("FlightDriver.RevertToPrelaunch(", System.StringComparison.Ordinal);

            Assert.True(gate >= 0, "RevertToEditor must refuse outside the flight scene");
            Assert.True(flag >= 0 && call >= 0);
            Assert.True(gate < flag && gate < call, "the scene gate must come before the revert flag is read");
        }

        /// <summary>
        /// The same refusal <c>Launch</c> and <c>SwitchVessel</c> give from the
        /// wrong scene, so a client renders all of them with one sentence.
        /// </summary>
        [Fact]
        public void BothRefusalsAreWrongSceneAndNameTheScene()
        {
            Assert.Contains(WrongSceneRefusal, RevertToLaunchBody());
            Assert.Contains(WrongSceneRefusal, RevertToEditorBody());
        }
    }
}
