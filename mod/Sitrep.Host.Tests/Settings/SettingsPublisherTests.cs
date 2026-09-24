using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host.Settings;
using Xunit;

namespace Sitrep.Host.Tests.Settings
{
    /// <summary>
    /// <c>settings.gonogo</c> and <c>settings.save</c>: what a client is told
    /// about every declared setting, and what one SAVE press does to the store
    /// and the file.
    /// </summary>
    public class SettingsPublisherTests
    {
        private const string Enabled = "SIGNAL_DELAY/enabled";
        private const string Scale = "SIGNAL_DELAY/lightSpeedScale";
        private const string Slip = "Uplinks/Rp1/upgradeSlipWarningDays";

        private static readonly Dictionary<string, string> NoFailures = new Dictionary<string, string>();

        private static (SettingsStore Store, InMemorySettingsStore Backing) Store()
        {
            var backing = new InMemorySettingsStore();
            var store = new SettingsStore(backing);
            store.Declare(SettingsRow.Bool(Enabled, true, "Apply light-time delay"));
            store.Declare(SettingsRow.Number(Scale, 1.0, "Light speed scale"));
            store.Declare(SettingsRow.Number(Slip, 30, "Slip warning"));
            return (store, backing);
        }

        private static SettingsPublisher Publisher(SettingsStore store, double ut = 1000) =>
            new SettingsPublisher(store, () => NoFailures, () => ut);

        private static List<Dictionary<string, object?>> Rows(SettingsPublisher publisher)
        {
            var rows = new List<Dictionary<string, object?>>();
            foreach (var row in (List<object?>)Model(publisher)["rows"]!)
            {
                rows.Add((Dictionary<string, object?>)row!);
            }

            return rows;
        }

        private static Dictionary<string, object?> Model(SettingsPublisher publisher) =>
            (Dictionary<string, object?>)publisher.Snapshot;

        private static Dictionary<string, object?> PersistenceOf(SettingsPublisher publisher) =>
            (Dictionary<string, object?>)Model(publisher)["persistence"]!;

        private static SaveSettingsArgs Saving(params (string path, string value)[] changes)
        {
            var args = new SaveSettingsArgs();
            foreach (var (path, value) in changes)
            {
                args.Changes.Add(new SettingsChange { Path = path, Value = value });
            }

            return args;
        }

        [Fact]
        public void EveryDeclaredRowIsPublishedWithWhatAClientNeedsToDrawIt()
        {
            var (store, _) = Store();

            var rows = Rows(Publisher(store));

            Assert.Equal(new[] { Enabled, Scale, Slip }, rows.ConvertAll(r => (string)r["path"]!));
            Assert.Equal("gonogo", rows[0]["owner"]);
            Assert.Equal("Rp1", rows[2]["owner"]);
            Assert.Equal(SettingKind.Bool, rows[0]["kind"]);
            Assert.Equal(SettingKind.Number, rows[1]["kind"]);
            Assert.Equal("Apply light-time delay", rows[0]["label"]);
            Assert.Equal("True", rows[0]["value"]);
            Assert.Equal("1", rows[1]["default"]);
        }

        /// <summary>One press, one write, and the payload says what the file now holds.</summary>
        [Fact]
        public void ASaveAppliesEveryChangeWritesOnceAndRepublishes()
        {
            var (store, backing) = Store();
            var publisher = Publisher(store, ut: 4242);

            var result = publisher.Save(Saving((Enabled, "False"), (Scale, "0.1")));

            Assert.True(result.Success);
            Assert.Null(result.Detail);
            Assert.Equal(1, backing.Writes);
            Assert.Equal("False", Rows(publisher)[0]["value"]);
            Assert.Equal("0.1", Rows(publisher)[1]["value"]);
            Assert.Equal(SettingsPersistenceState.Saved, PersistenceOf(publisher)["state"]);
            Assert.Equal(4242.0, PersistenceOf(publisher)["savedAtUt"]);
        }

        /// <summary>
        /// A press with one bad value changes nothing, including the good values
        /// beside it, so the operator is never left with half of what they
        /// pressed SAVE on.
        /// </summary>
        [Fact]
        public void ARefusedSaveChangesNothingAtAll()
        {
            var (store, backing) = Store();
            var publisher = Publisher(store);

            var result = publisher.Save(Saving((Enabled, "False"), (Scale, "fast")));

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.Range, result.ErrorCode);
            Assert.Contains(Scale, result.Detail);
            Assert.Equal(0, backing.Writes);
            Assert.Equal("True", store.Text(Enabled));
        }

        [Fact]
        public void ASaveNamingNoDeclaredSettingIsRefused()
        {
            var (store, _) = Store();

            var result = Publisher(store).Save(Saving(("Uplinks/Ghost/x", "1")));

            Assert.False(result.Success);
            Assert.Contains("no setting is declared", result.Detail);
        }

        [Fact]
        public void AValueTheFileCannotCarryIsRefused()
        {
            var (store, _) = Store();

            var result = Publisher(store).Save(Saving((Slip, "3//0")));

            Assert.False(result.Success);
            Assert.Contains("//", result.Detail);
        }

        /// <summary>
        /// A write that fails is not a refusal: the values are in force, so the
        /// command succeeds, and the payload is what tells every screen the file
        /// does not hold them.
        /// </summary>
        [Fact]
        public void ASaveTheFileCouldNotTakeIsInForceAndSaysSoOnTheTopic()
        {
            var (store, backing) = Store();
            var publisher = Publisher(store);
            backing.FailWith = "read-only GameData";

            var result = publisher.Save(Saving((Enabled, "False")));

            Assert.True(result.Success);
            Assert.Contains("read-only GameData", result.Detail);
            Assert.Equal("False", Rows(publisher)[0]["value"]);
            Assert.Equal(SettingsPersistenceState.MemoryOnly, PersistenceOf(publisher)["state"]);
            Assert.Equal("read-only GameData", PersistenceOf(publisher)["reason"]);
            Assert.Null(PersistenceOf(publisher)["savedAtUt"]);
        }

        /// <summary>
        /// A save that timed out may still land, so sending it again must be
        /// harmless: the second leaves every value where the first put it.
        /// </summary>
        [Fact]
        public void SendingTheSameSaveTwiceLeavesTheSameValues()
        {
            var (store, backing) = Store();
            var publisher = Publisher(store);
            var args = Saving((Enabled, "False"), (Scale, "0.1"));

            publisher.Save(args);
            var once = backing.Read();
            publisher.Save(args);

            Assert.Null(backing.Read().FirstDifferenceFrom(once));
        }

        /// <summary>A commit made by any other path, such as one of the mod's own commands, is republished too.</summary>
        [Fact]
        public void ACommitFromAnotherPathIsRepublished()
        {
            var (store, _) = Store();
            var publisher = Publisher(store);

            store.Stage(Enabled, false);
            store.Commit();

            Assert.Equal("False", Rows(publisher)[0]["value"]);
        }

        [Fact]
        public void AnUplinkWhoseSettingsCouldNotBeDeclaredIsListed()
        {
            var (store, _) = Store();
            var failures = new Dictionary<string, string> { ["Broken"] = "settings declaration threw: typo" };

            var publisher = new SettingsPublisher(store, () => failures, () => 0);

            var undeclared = (List<object?>)Model(publisher)["undeclared"]!;
            var only = (Dictionary<string, object?>)Assert.Single(undeclared)!;
            Assert.Equal("Broken", only["uplinkId"]);
            Assert.Equal("settings declaration threw: typo", only["reason"]);
        }

        private sealed class ReadingFrom : ISettingsBackingStore
        {
            internal ReadingFrom(SettingsReadSource source)
            {
                LastReadFrom = source;
            }

            public string Path => "gonogo.cfg";

            public SettingsReadSource LastReadFrom { get; }

            public SettingsDocument Read() => new SettingsDocument();

            public SettingsDocument? ReadIfChangedElsewhere() => null;

            public WriteOutcome Write(SettingsDocument document) => WriteOutcome.Written(Path);
        }

        /// <summary>
        /// Every way a launch can read the file names a persistence state, so
        /// the publisher's refusal to guess one for an unmapped source cannot be
        /// reached.
        /// </summary>
        [Fact]
        public void EveryReadSourceHasAPersistenceState()
        {
            var expected = new Dictionary<SettingsReadSource, SettingsPersistenceState>
            {
                [SettingsReadSource.File] = SettingsPersistenceState.Saved,
                [SettingsReadSource.Backup] = SettingsPersistenceState.Recovered,
                [SettingsReadSource.NoFile] = SettingsPersistenceState.Defaults,
                [SettingsReadSource.Unreadable] = SettingsPersistenceState.Unreadable,
            };

            foreach (SettingsReadSource source in Enum.GetValues(typeof(SettingsReadSource)))
            {
                Assert.True(expected.ContainsKey(source), source + " has no expected persistence state here");
                var publisher = Publisher(new SettingsStore(new ReadingFrom(source)));
                Assert.Equal(expected[source], PersistenceOf(publisher)["state"]);
            }
        }

        /// <summary>
        /// A recovery is standing information until the next save clears it, so
        /// an operator who connects after start-up still hears that the last
        /// session's settings were lost.
        /// </summary>
        [Fact]
        public void ARecoveryIsReportedUntilASaveClearsIt()
        {
            var store = new SettingsStore(new ReadingFrom(SettingsReadSource.Backup));
            store.Declare(SettingsRow.Bool(Enabled, true));
            var publisher = Publisher(store);

            Assert.Equal(SettingsPersistenceState.Recovered, PersistenceOf(publisher)["state"]);
            Assert.NotNull(PersistenceOf(publisher)["reason"]);

            publisher.Save(Saving((Enabled, "False")));

            Assert.Equal(SettingsPersistenceState.Saved, PersistenceOf(publisher)["state"]);
        }

        /// <summary>
        /// Nothing in settings is delayed. A setting configures the system the
        /// operator sits at, and the one that configures the delay model itself
        /// being late by the delay it sets would make it unusable.
        /// </summary>
        [Fact]
        public void TheSettingsTopicAndItsSaveAreTrueNow()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0");

            Assert.Equal(DelayRole.TrueNow, engine.DeclarationOf(ChannelEngine.SettingsTopic)!.Delay);
            Assert.True(CommandDelayCatalog.TryGetDelay(ChannelEngine.SaveSettingsCommand, out var delay));
            Assert.Equal(DelayRole.TrueNow, delay);
        }

        [Fact]
        public void TheEnginePublishesTheModelOnceItHasAStore()
        {
            var (store, _) = Store();
            var engine = new ChannelEngine("ws://127.0.0.1:0");
            Assert.Null(engine.PayloadOf(ChannelEngine.SettingsTopic));

            engine.Settings = store;
            engine.RegisterDiscoveredUplinks(Array.Empty<UplinkDiscovery.DiscoveredUplink>());
            Assert.NotNull(engine.PayloadOf(ChannelEngine.SettingsTopic));

            var result = (CommandResult)engine.InvokeCommandHandler(
                ChannelEngine.SaveSettingsCommand, Saving((Enabled, "False")), vantage: "")!;

            Assert.True(result.Success);
            Assert.Equal("False", store.Text(Enabled));
            var published = (List<object?>)((Dictionary<string, object?>)engine.PayloadOf(ChannelEngine.SettingsTopic)!)["rows"]!;
            Assert.Equal("False", ((Dictionary<string, object?>)published[0]!)["value"]);
        }
    }
}
