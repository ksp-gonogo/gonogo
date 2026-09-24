using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host.Settings;
using Xunit;

namespace Sitrep.Host.Tests.Settings
{
    /// <summary>
    /// An Uplink's own settings, declared through
    /// <see cref="IUplinkSettingsDeclarer"/> into <c>Uplinks { &lt;id&gt; }</c>,
    /// by the real engine's discovery passes.
    /// </summary>
    public class UplinkSettingsDeclarationTests
    {
        private sealed class SettingsUplink : ISitrepUplink, IUplinkSettingsDeclarer
        {
            private readonly Action<IUplinkSettings> _declare;

            internal SettingsUplink(string id, string version, Action<IUplinkSettings> declare)
            {
                Manifest = new UplinkManifest { Id = id, Version = version };
                _declare = declare;
            }

            public UplinkManifest Manifest { get; }

            public IUplinkSettings? Handle { get; private set; }

            public bool Registered { get; private set; }

            /// <summary>What the uplink read for its own setting while it registered, which is when a real one configures itself.</summary>
            public string? ReadDuringRegister { get; private set; }

            public bool DeclareRan { get; private set; }

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public void DeclareSettings(IUplinkSettings settings)
            {
                DeclareRan = true;
                Handle = settings;
                _declare(settings);
            }

            public void Register(IUplinkHost host)
            {
                Registered = true;
                ReadDuringRegister = Handle?.Text("upgradeSlipWarningDays");
            }
        }

        private sealed class CapabilityThrowingUplink : ISitrepUplink, IUplinkCapabilityDeclarer, IUplinkSettingsDeclarer
        {
            public UplinkManifest Manifest { get; } = new UplinkManifest { Id = "Broken", Version = "1.0.0" };

            public bool DeclareSettingsRan { get; private set; }

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public void DeclareCapabilities(Kernel kernel) => throw new InvalidOperationException("capability typo");

            public void DeclareSettings(IUplinkSettings settings)
            {
                DeclareSettingsRan = true;
                settings.Declare(UplinkSettingRow.Bool("flag", true, "Flag"));
            }

            public void Register(IUplinkHost host) { }
        }

        private static SettingsDocument FileWith(string uplinkId, string writtenBy, params (string name, string text)[] rows)
        {
            var document = new SettingsDocument();
            document.Set("SIGNAL_DELAY/enabled", "True");
            var block = document.Root.BlockOrAdd("Uplinks").BlockOrAdd(uplinkId);
            block.SetValue(UplinkSettingsScope.WrittenByName, writtenBy);
            foreach (var (name, text) in rows)
            {
                block.SetValue(name, text);
            }

            return document;
        }

        private static ChannelEngine Discover(SettingsStore store, params ISitrepUplink[] uplinks) =>
            Discover(store, ContractVersion.Major, uplinks);

        private static ChannelEngine Discover(SettingsStore store, int contractMajor, params ISitrepUplink[] uplinks)
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0") { Settings = store };
            var discovered = new List<UplinkDiscovery.DiscoveredUplink>();
            foreach (var uplink in uplinks)
            {
                discovered.Add(new UplinkDiscovery.DiscoveredUplink(
                    uplink, contractMajor, ContractVersion.Minor, uplink.Manifest.Id));
            }

            engine.RegisterDiscoveredUplinks(discovered);
            return engine;
        }

        [Fact]
        public void ADeclaredSettingIsInForceWhileTheUplinkRegisters()
        {
            var store = new SettingsStore(new InMemorySettingsStore(FileWith("Rp1", "0.4.1", ("upgradeSlipWarningDays", "45"))));
            var uplink = new SettingsUplink("Rp1", "0.4.1",
                s => s.Declare(UplinkSettingRow.Number("upgradeSlipWarningDays", 30, "Slip warning")));

            Discover(store, uplink);

            Assert.True(uplink.Registered);
            Assert.Equal("45", uplink.ReadDuringRegister);
        }

        /// <summary>
        /// The migration seam: the initialiser is handed the block as it was
        /// stored and the version that stored it, before anything of its own
        /// has touched it.
        /// </summary>
        [Fact]
        public void ABlockAnOlderVersionWroteReachesTheInitialiserWithThatVersion()
        {
            var store = new SettingsStore(new InMemorySettingsStore(FileWith("Rp1", "0.3.0", ("slipDays", "45"))));
            string? heardVersion = null;
            string? heardOldValue = null;
            IReadOnlyList<string>? heardNames = null;
            var uplink = new SettingsUplink("Rp1", "0.4.1", s =>
            {
                heardVersion = s.WrittenBy;
                heardOldValue = s.Stored("slipDays");
                heardNames = new List<string>(s.StoredNames);
                s.Declare(UplinkSettingRow.Number("upgradeSlipWarningDays", 30, "Slip warning"));
                if (s.WrittenBy == "0.3.0" && s.Stored("slipDays") is string old)
                {
                    s.Migrate("upgradeSlipWarningDays", old);
                }
            });

            Discover(store, uplink);

            Assert.Equal("0.3.0", heardVersion);
            Assert.Equal("45", heardOldValue);
            Assert.Equal(new[] { "slipDays" }, heardNames);
            Assert.Equal(45, uplink.Handle!.Number("upgradeSlipWarningDays"));
        }

        /// <summary>
        /// What was migrated and the version that now owns the block reach the
        /// file with the next save, and a row this version no longer declares
        /// is kept rather than cleaned up.
        /// </summary>
        [Fact]
        public void TheNextSaveCarriesTheMigrationAndTheNewVersionAndKeepsTheOldRow()
        {
            var backing = new InMemorySettingsStore(FileWith("Rp1", "0.3.0", ("slipDays", "45")));
            var store = new SettingsStore(backing);
            var uplink = new SettingsUplink("Rp1", "0.4.1", s =>
            {
                s.Declare(UplinkSettingRow.Number("upgradeSlipWarningDays", 30, "Slip warning"));
                s.Migrate("upgradeSlipWarningDays", s.Stored("slipDays")!);
            });
            Discover(store, uplink);

            store.Stage("SIGNAL_DELAY/enabled", false);
            store.Commit();

            var written = backing.Read();
            Assert.Equal("45", written.Text("Uplinks/Rp1/upgradeSlipWarningDays"));
            Assert.Equal("0.4.1", written.Text("Uplinks/Rp1/writtenBy"));
            Assert.Equal("45", written.Text("Uplinks/Rp1/slipDays"));
        }

        [Fact]
        public void NoStoredBlockMeansNeverAskedNotAnOlderVersion()
        {
            var store = new SettingsStore(new InMemorySettingsStore());
            string? heard = "unset";
            var uplink = new SettingsUplink("Rp1", "0.4.1", s => heard = s.WrittenBy);

            Discover(store, uplink);

            Assert.Null(heard);
        }

        /// <summary>
        /// The reason the declarer has a pass of its own. A throw costs the
        /// uplink its settings for the session and nothing else: it still
        /// registers, and nothing it declared before the throw reaches the
        /// document, so its stored block is written back exactly as it was.
        /// </summary>
        [Fact]
        public void AThrowingDeclarerLeavesTheUplinkRegisteredAndItsBlockUntouched()
        {
            var seed = FileWith("Rp1", "0.3.0", ("upgradeSlipWarningDays", "45"));
            var backing = new InMemorySettingsStore(seed);
            var store = new SettingsStore(backing);
            var uplink = new SettingsUplink("Rp1", "0.4.1", s =>
            {
                s.Declare(UplinkSettingRow.Number("upgradeSlipWarningDays", 30, "Slip warning"));
                s.Declare(UplinkSettingRow.Bool("newRow", true, "New"));
                s.Migrate("upgradeSlipWarningDays", "60");
                throw new InvalidOperationException("descriptor typo");
            });

            var engine = Discover(store, uplink);
            store.Stage("SIGNAL_DELAY/enabled", false);
            store.Commit();

            Assert.True(uplink.Registered);
            Assert.Contains("descriptor typo", engine.SettingsDeclarationFailures["Rp1"]);
            Assert.Null(RowsOf(backing.Read(), "Rp1").FirstDifferenceFrom(RowsOf(seed, "Rp1")));
            // The handle still answers, with the defaults it was told.
            Assert.Equal(30, uplink.Handle!.Number("upgradeSlipWarningDays"));
        }

        /// <summary>
        /// A mistyped row is refused inside the declarer, and so lands in the
        /// same fail-soft as any other throw rather than in the uplink's
        /// registration.
        /// </summary>
        [Fact]
        public void ARowTheFileCannotCarryIsAThrowNotALostUplink()
        {
            var store = new SettingsStore(new InMemorySettingsStore());
            var uplink = new SettingsUplink("Rp1", "0.4.1",
                s => s.Declare(UplinkSettingRow.Text("endpoint", "ws://localhost:8090", "Endpoint")));

            var engine = Discover(store, uplink);

            Assert.True(uplink.Registered);
            Assert.Contains("//", engine.SettingsDeclarationFailures["Rp1"]);
            Assert.Null(store.Text("Uplinks/Rp1/endpoint"));
        }

        /// <summary>
        /// The two ways an uplink leaves a launch with no declarer: refused on
        /// its contract major, or failed while declaring its capability. They
        /// reach the same outcome by different code, so each is tested.
        /// </summary>
        [Fact]
        public void AnUplinkRefusedOnItsContractMajorNeverDeclaresAndKeepsItsBlock()
        {
            var seed = FileWith("Rp1", "0.3.0", ("upgradeSlipWarningDays", "45"));
            var backing = new InMemorySettingsStore(seed);
            var store = new SettingsStore(backing);
            var uplink = new SettingsUplink("Rp1", "0.4.1",
                s => s.Declare(UplinkSettingRow.Number("upgradeSlipWarningDays", 30, "Slip warning")));

            Discover(store, ContractVersion.Major + 1, uplink);
            store.Stage("SIGNAL_DELAY/enabled", false);
            store.Commit();

            Assert.False(uplink.DeclareRan);
            Assert.Null(RowsOf(backing.Read(), "Rp1").FirstDifferenceFrom(RowsOf(seed, "Rp1")));
        }

        [Fact]
        public void AnUplinkWhoseCapabilityDeclarationThrewNeverDeclaresAndKeepsItsBlock()
        {
            var seed = FileWith("Broken", "0.9.0", ("flag", "False"));
            var backing = new InMemorySettingsStore(seed);
            var store = new SettingsStore(backing);
            var uplink = new CapabilityThrowingUplink();

            Discover(store, uplink);
            store.Stage("SIGNAL_DELAY/enabled", false);
            store.Commit();

            Assert.False(uplink.DeclareSettingsRan);
            Assert.Null(RowsOf(backing.Read(), "Broken").FirstDifferenceFrom(RowsOf(seed, "Broken")));
        }

        /// <summary>
        /// A subscription taken inside the declarer is heard once the block is
        /// in the store, with the real values, and hears later saves.
        /// </summary>
        [Fact]
        public void ASubscriptionTakenWhileDeclaringHearsTheStoredValueThenChanges()
        {
            var store = new SettingsStore(new InMemorySettingsStore(FileWith("Rp1", "0.4.1", ("upgradeSlipWarningDays", "45"))));
            var heard = new List<double>();
            var uplink = new SettingsUplink("Rp1", "0.4.1", s =>
            {
                s.Declare(UplinkSettingRow.Number("upgradeSlipWarningDays", 30, "Slip warning"));
                s.OnChanged(block => heard.Add(block.Number("upgradeSlipWarningDays")));
            });

            Discover(store, uplink);
            store.Stage("Uplinks/Rp1/upgradeSlipWarningDays", 60);
            store.Commit();

            Assert.Equal(new[] { 45.0, 60.0 }, heard);
        }

        [Fact]
        public void DeclaringOutsideTheDeclarerIsRefused()
        {
            var store = new SettingsStore(new InMemorySettingsStore());
            var uplink = new SettingsUplink("Rp1", "0.4.1", _ => { });
            Discover(store, uplink);

            Assert.Throws<InvalidOperationException>(
                () => uplink.Handle!.Declare(UplinkSettingRow.Bool("late", true, "Late")));
        }

        private static List<Dictionary<string, object?>> ModSettingsOf(ChannelEngine engine)
        {
            var model = (Dictionary<string, object?>)engine.PayloadOf(ChannelEngine.SettingsTopic)!;
            var shown = new List<Dictionary<string, object?>>();
            foreach (var entry in (List<object?>)model["modSettings"]!)
            {
                shown.Add((Dictionary<string, object?>)entry!);
            }

            return shown;
        }

        /// <summary>
        /// A mod's own setting, shown by its Uplink, reaches the settings model
        /// under that Uplink. Shown again later with a new value, it keeps its
        /// place and carries the latest value, because a mod's settings can
        /// change while the game runs.
        /// </summary>
        [Fact]
        public void AModSettingAnUplinkShowsIsPublishedAndItsLatestValueWins()
        {
            var store = new SettingsStore(new InMemorySettingsStore());
            var uplink = new SettingsUplink("rp1", "0.4.1", s =>
            {
                s.ShowModSetting("difficulty", "Career difficulty", "Normal");
                s.ShowModSetting("procedural", "Procedural parts", "On");
            });

            var engine = Discover(store, uplink);
            uplink.Handle!.ShowModSetting("difficulty", "Career difficulty", "Hard");

            var shown = ModSettingsOf(engine);
            Assert.Equal(new[] { "difficulty", "procedural" }, shown.ConvertAll(s => (string)s["name"]!));
            Assert.Equal("Hard", shown[0]["value"]);
            Assert.Equal("rp1", shown[0]["owner"]);
            Assert.Equal("Career difficulty", shown[0]["label"]);
        }

        /// <summary>
        /// A mod's setting is a fact about the mod, not part of the Uplink's own
        /// declaration, so one shown before a declarer throws is still shown.
        /// </summary>
        [Fact]
        public void AModSettingShownBeforeTheDeclarerThrewIsStillShown()
        {
            var store = new SettingsStore(new InMemorySettingsStore());
            var uplink = new SettingsUplink("rp1", "0.4.1", s =>
            {
                s.ShowModSetting("difficulty", "Career difficulty", "Normal");
                throw new InvalidOperationException("descriptor typo");
            });

            var engine = Discover(store, uplink);

            Assert.Single(ModSettingsOf(engine));
        }

        [Fact]
        public void NoModSettingIsShownUnlessAnUplinkShowsOne()
        {
            var store = new SettingsStore(new InMemorySettingsStore());

            var engine = Discover(store, new SettingsUplink("rp1", "0.4.1", _ => { }));

            Assert.Empty(ModSettingsOf(engine));
        }

        /// <summary>One uplink's block as a document of its own, so two can be compared entry for entry.</summary>
        private static SettingsDocument RowsOf(SettingsDocument document, string uplinkId)
        {
            var only = new SettingsDocument();
            var block = document.Root.Block("Uplinks")?.Block(uplinkId);
            if (block != null)
            {
                var target = only.Root.BlockOrAdd(uplinkId);
                foreach (var entry in block.Values)
                {
                    target.AppendValue(entry.Name, entry.Text);
                }
            }

            return only;
        }
    }
}
