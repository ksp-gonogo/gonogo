using System;
using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests.ObjectiveDelay
{
    /// <summary>
    /// The line's book is unit-tested on its own; these read the shipped source
    /// the test project cannot compile (a ScenarioModule, Harmony prefixes) to
    /// show the game reaches it: bound when a save wakes, released every frame,
    /// saved and loaded with the credit ledger, readable in the editor.
    /// </summary>
    public class ObjectiveDelayIsWiredTests
    {
        private static string Books => CurrencyDelaySourceText.Read("CurrencyDelayBooks.cs");

        [Fact]
        public void TheBooksBindReleaseSaveAndLoadTheLine()
        {
            Assert.Contains("ObjectiveDelayLine.Bind(_objectives)", CurrencyDelaySourceText.MethodBody(Books, "internal void Start()"), StringComparison.Ordinal);
            Assert.Contains("_objectives.Release(", CurrencyDelaySourceText.MethodBody(Books, "internal void Tick()"), StringComparison.Ordinal);
            Assert.Contains("ObjectiveDelayPersistence.Save(_objectives", CurrencyDelaySourceText.MethodBody(Books, "internal void Save(ConfigNode node)"), StringComparison.Ordinal);
            Assert.Contains("ObjectiveDelayPersistence.Load(_objectives", CurrencyDelaySourceText.MethodBody(Books, "internal void Load(ConfigNode node)"), StringComparison.Ordinal);
            Assert.Contains("ObjectiveDelayLine.Unbind(_objectives)", CurrencyDelaySourceText.MethodBody(Books, "internal void Stop()"), StringComparison.Ordinal);
        }

        /// <summary>The game updates contracts in the editor too, so a deadline held in flight would expire on entering it without a loaded line.</summary>
        [Fact]
        public void TheScenarioIsLoadedInTheEditor()
        {
            var scenario = CurrencyDelaySourceText.Read("CurrencyDelayScenario.cs");
            var attribute = scenario.Substring(scenario.IndexOf("[KSPScenario(", StringComparison.Ordinal));
            attribute = attribute.Substring(0, attribute.IndexOf(']'));

            Assert.Contains("GameScenes.EDITOR", attribute, StringComparison.Ordinal);
            Assert.Contains("GameScenes.FLIGHT", attribute, StringComparison.Ordinal);
            Assert.Contains("GameScenes.SPACECENTER", attribute, StringComparison.Ordinal);
            Assert.Contains("GameScenes.TRACKSTATION", attribute, StringComparison.Ordinal);
        }

        [Fact]
        public void TheCurrencyUplinkDeclaresTheCapabilityAndInstallsTheHooks()
        {
            var uplink = CurrencyDelaySourceText.ReadRelative("CurrencyEventUplink.cs");

            Assert.Contains("ObjectiveDelayCapability.CapabilityId", CurrencyDelaySourceText.MethodBody(uplink, "public void DeclareCapabilities(Kernel kernel)"), StringComparison.Ordinal);
            Assert.Contains("StockObjectiveHooks.Install()", CurrencyDelaySourceText.MethodBody(uplink, "public void Register(IUplinkHost host)"), StringComparison.Ordinal);
        }

        [Fact]
        public void TheHooksPatchAllThreeStateChangesAndTheDeadline()
        {
            var hooks = CurrencyDelaySourceText.ReadRelative(System.IO.Path.Combine("ObjectiveDelay", "StockObjectiveHooks.cs"));
            var install = CurrencyDelaySourceText.MethodBody(hooks, "public static void Install()");

            foreach (var prefix in new[] { "SetCompletePrefix", "SetIncompletePrefix", "SetFailedPrefix", "DeadlinePrefix" })
            {
                Assert.Contains("nameof(" + prefix + ")", install, StringComparison.Ordinal);
            }
        }

        /// <summary>A held change replayed through the game's own method must not be caught and held again.</summary>
        [Fact]
        public void TheReplayRunsBehindTheGuardTheHooksCheck()
        {
            var hooks = CurrencyDelaySourceText.ReadRelative(System.IO.Path.Combine("ObjectiveDelay", "StockObjectiveHooks.cs"));

            Assert.Contains("ObjectiveDelayLine.Replaying.Active", CurrencyDelaySourceText.MethodBody(hooks, "private static bool Intercept(ContractParameter objective, ObjectiveState target)"), StringComparison.Ordinal);
            Assert.Contains("ObjectiveDelayLine.Replaying.RunGuarded", CurrencyDelaySourceText.MethodBody(hooks, "internal static void Apply(ObjectiveChange change)"), StringComparison.Ordinal);
        }

        [Fact]
        public void AFinishedContractIsAFactAtHome()
        {
            var career = CurrencyDelaySourceText.ReadRelative("CareerUplink.cs");
            var declaration = career.Substring(career.IndexOf("Topic = CareerViewProvider.ContractEventTopic", StringComparison.Ordinal));
            declaration = declaration.Substring(0, declaration.IndexOf("},", StringComparison.Ordinal));

            Assert.Contains("HeldAtHome = true", declaration, StringComparison.Ordinal);
        }

        /// <summary>A contract finished by its last parameter has no recorded finish time, so the stamp must come from the clock.</summary>
        [Fact]
        public void AContractFinishIsStampedThroughTheUnrecordedTimeRule()
        {
            var career = CurrencyDelaySourceText.ReadRelative("CareerUplink.cs");
            var body = CurrencyDelaySourceText.MethodBody(career, "private void PublishFinish(global::Contracts.Contract? contract, bool completed)");

            Assert.Contains("CareerViewProvider.ContractFinishUt(contract.DateFinished, _host.NowUt())", body, StringComparison.Ordinal);
        }
    }
}
