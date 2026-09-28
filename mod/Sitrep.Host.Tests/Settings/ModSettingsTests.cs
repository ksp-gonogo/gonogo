using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Contract.TestSupport;
using Sitrep.Host.Settings;
using Xunit;

namespace Sitrep.Host.Tests.Settings
{
    /// <summary>
    /// A host mod's own settings, listed and read through an Uplink's
    /// <see cref="IModSettingsSource"/> and written through its
    /// <see cref="IModSettingsWriter"/>, by the real engine.
    /// </summary>
    public class ModSettingsTests
    {
        /// <summary>A mod whose settings are fields the test sets, as a real Uplink's reflection hop would read them.</summary>
        private class ModUplink : ISitrepUplink, IModSettingsSource
        {
            internal ModUplink(string id, params ModSetting[] settings)
            {
                Manifest = new UplinkManifest { Id = id, Version = "1.0.0" };
                Listed = settings;
            }

            public UplinkManifest Manifest { get; }

            internal IReadOnlyList<ModSetting> Listed { get; set; }

            internal Func<IReadOnlyList<ModSetting>>? ListOverride { get; set; }

            internal Dictionary<string, ModSettingValue> Values { get; } =
                new Dictionary<string, ModSettingValue>(StringComparer.Ordinal);

            internal Dictionary<string, int> Reads { get; } = new Dictionary<string, int>(StringComparer.Ordinal);

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public void Register(IUplinkHost host) { }

            public IReadOnlyList<ModSetting> ListModSettings() => ListOverride?.Invoke() ?? Listed;

            public ModSettingValue ReadModSetting(string id)
            {
                Reads[id] = Reads.TryGetValue(id, out var n) ? n + 1 : 1;
                return Values.TryGetValue(id, out var value) ? value : ModSettingValue.Unavailable("no save loaded");
            }
        }

        private sealed class WritableModUplink : ModUplink, IModSettingsWriter
        {
            internal WritableModUplink(string id, params ModSetting[] settings)
                : base(id, settings)
            {
            }

            internal List<(string Id, ModSettingValue Value)> Writes { get; } = new List<(string, ModSettingValue)>();

            internal CommandResult? Answer { get; set; }

            public CommandResult WriteModSetting(string id, ModSettingValue value)
            {
                Writes.Add((id, value));
                if (Answer != null)
                {
                    return Answer;
                }

                Values[id] = value;
                return CommandResult.Ok();
            }
        }

        private static readonly ModSetting Reliability =
            ModSetting.Bool("reliability", "Part reliability", ModSettingRefresh.Launch, group: "Reliability", setIn: "Survival profile");

        private static readonly ModSetting Wear =
            ModSetting.Bool("mtbfFailures", "Failures from wear", ModSettingRefresh.Save, setIn: "Difficulty settings, Survival");

        private static readonly ModSetting Chance =
            ModSetting.Number("criticalChance", "Critical failure chance", Units.Ratio, ModSettingRefresh.Save);

        private static readonly ModSetting Throttle =
            ModSetting.Bool("throttleMainRender", "Throttle KSP main render", ModSettingRefresh.Live, writable: true);

        private sealed class Clock
        {
            internal double Now { get; set; }
        }

        private static (ChannelEngine Engine, Clock Clock) Discover(params ISitrepUplink[] uplinks)
        {
            var clock = new Clock();
            var engine = new ChannelEngine("ws://127.0.0.1:0") { Settings = new SettingsStore(new InMemorySettingsStore()) };
            engine.SetRealClockForTests(() => clock.Now);
            var discovered = new List<UplinkDiscovery.DiscoveredUplink>();
            foreach (var uplink in uplinks)
            {
                discovered.Add(new UplinkDiscovery.DiscoveredUplink(
                    uplink, ContractVersion.Major, ContractVersion.Minor, uplink.Manifest.Id));
            }

            engine.RegisterDiscoveredUplinks(discovered);
            return (engine, clock);
        }

        private static Dictionary<string, object?> Model(ChannelEngine engine, string uplinkId) =>
            (Dictionary<string, object?>)engine.PayloadOf("settings." + uplinkId)!;

        private static Dictionary<string, object?> Row(ChannelEngine engine, string uplinkId, string id)
        {
            foreach (var row in (List<object?>)Model(engine, uplinkId)["settings"]!)
            {
                var fields = (Dictionary<string, object?>)row!;
                if ((string)fields["id"]! == id)
                {
                    return fields;
                }
            }

            throw new KeyNotFoundException(id);
        }

        private static CommandResult Write(ChannelEngine engine, string uplink, string id, string value) =>
            (CommandResult)engine.InvokeCommandHandler(
                ChannelEngine.WriteModSettingCommand,
                new WriteModSettingArgs { Uplink = uplink, Id = id, Value = value },
                vantage: "")!;

        [Fact]
        public void EachListedSettingIsPublishedOnItsUplinksOwnTrueNowTopic()
        {
            var uplink = new ModUplink("survival", Reliability, Wear, Chance);
            uplink.Values["reliability"] = ModSettingValue.Of(true);
            uplink.Values["criticalChance"] = ModSettingValue.Of(0.25);
            var (engine, _) = Discover(uplink);

            engine.SampleModSettings("SPACECENTER/1");

            Assert.Equal(DelayRole.TrueNow, engine.DeclarationOf("settings.survival")!.Delay);
            var model = Model(engine, "survival");
            Assert.Equal("survival", model["uplink"]);
            Assert.Null(model["failure"]);
            var reliability = Row(engine, "survival", "reliability");
            Assert.Equal("True", reliability["value"]);
            Assert.Null(reliability["unavailable"]);
            Assert.Equal("Reliability", reliability["group"]);
            Assert.Equal("Survival profile", reliability["setIn"]);
            Assert.Equal(false, reliability["writable"]);
            Assert.Equal("0.25", Row(engine, "survival", "criticalChance")["value"]);
            Assert.Equal(Units.Ratio, Row(engine, "survival", "criticalChance")["unit"]);
        }

        /// <summary>A setting that cannot be read yet carries why, never a false or a zero.</summary>
        [Fact]
        public void ASettingThatCannotBeReadCarriesItsReasonAndNoValue()
        {
            var (engine, _) = Discover(new ModUplink("survival", Wear));

            Assert.Equal("not read yet", Row(engine, "survival", "mtbfFailures")["unavailable"]);
            engine.SampleModSettings("SPACECENTER/1");

            var wear = Row(engine, "survival", "mtbfFailures");
            Assert.Null(wear["value"]);
            Assert.Equal("no save loaded", wear["unavailable"]);
        }

        [Fact]
        public void AnUplinkWithModSettingsSaysSoOnTheUplinkRoster()
        {
            var (engine, _) = Discover(new ModUplink("survival", Wear), new ModUplink2());

            var roster = (List<object?>)((Dictionary<string, object?>)engine.PayloadOf(ChannelEngine.UplinksTopic)!)["uplinks"]!;
            var flags = new Dictionary<string, object?>();
            foreach (var entry in roster)
            {
                var fields = (Dictionary<string, object?>)entry!;
                flags[(string)fields["id"]!] = fields["modSettings"];
            }

            Assert.Equal(true, flags["survival"]);
            Assert.Equal(false, flags["plain"]);
            Assert.Null(engine.PayloadOf("settings.plain"));
        }

        private sealed class ModUplink2 : ISitrepUplink
        {
            public UplinkManifest Manifest { get; } = new UplinkManifest { Id = "plain", Version = "1.0.0" };

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public void Register(IUplinkHost host) { }
        }

        /// <summary>A launch setting is read until one read answers, then never again.</summary>
        [Fact]
        public void ALaunchSettingIsReadUntilItAnswersThenNeverAgain()
        {
            var uplink = new ModUplink("survival", Reliability);
            var (engine, clock) = Discover(uplink);

            engine.SampleModSettings("SPACECENTER/1");
            clock.Now = 1;
            uplink.Values["reliability"] = ModSettingValue.Of(true);
            engine.SampleModSettings("SPACECENTER/1");
            clock.Now = 2;
            uplink.Values["reliability"] = ModSettingValue.Of(false);
            engine.SampleModSettings("FLIGHT/2");

            Assert.Equal(2, uplink.Reads["reliability"]);
            Assert.Equal("True", Row(engine, "survival", "reliability")["value"]);
        }

        /// <summary>A save's setting is read again only when the save or the scene changes.</summary>
        [Fact]
        public void ASaveSettingIsReadAgainOnlyWhenTheSaveKeyChanges()
        {
            var uplink = new ModUplink("survival", Wear);
            uplink.Values["mtbfFailures"] = ModSettingValue.Of(true);
            var (engine, clock) = Discover(uplink);

            engine.SampleModSettings("SPACECENTER/1");
            uplink.Values["mtbfFailures"] = ModSettingValue.Of(false);
            clock.Now = 5;
            engine.SampleModSettings("SPACECENTER/1");
            Assert.Equal("True", Row(engine, "survival", "mtbfFailures")["value"]);

            engine.SampleModSettings("FLIGHT/1");
            Assert.Equal("False", Row(engine, "survival", "mtbfFailures")["value"]);
            Assert.Equal(2, uplink.Reads["mtbfFailures"]);
        }

        /// <summary>A live setting is read at most once a second, however often the host asks.</summary>
        [Fact]
        public void ALiveSettingIsReadOnceASecond()
        {
            var uplink = new WritableModUplink("streamer", Throttle);
            uplink.Values["throttleMainRender"] = ModSettingValue.Of(false);
            var (engine, clock) = Discover(uplink);

            engine.SampleModSettings("FLIGHT/1");
            clock.Now = 0.5;
            engine.SampleModSettings("FLIGHT/1");
            clock.Now = 1.0;
            uplink.Values["throttleMainRender"] = ModSettingValue.Of(true);
            engine.SampleModSettings("FLIGHT/1");

            Assert.Equal(2, uplink.Reads["throttleMainRender"]);
            Assert.Equal("True", Row(engine, "streamer", "throttleMainRender")["value"]);
        }

        [Fact]
        public void AReadThatThrowsOrAnswersTheWrongKindReadsAsUnavailable()
        {
            var uplink = new ThrowingReadUplink();
            var (engine, _) = Discover(uplink);

            engine.SampleModSettings("FLIGHT/1");

            Assert.Contains("reflection broke", (string)Row(engine, "odd", "a")["unavailable"]!);
            Assert.Contains("Number", (string)Row(engine, "odd", "b")["unavailable"]!);
            Assert.Null(Row(engine, "odd", "b")["value"]);
        }

        private sealed class ThrowingReadUplink : ISitrepUplink, IModSettingsSource
        {
            public UplinkManifest Manifest { get; } = new UplinkManifest { Id = "odd", Version = "1.0.0" };

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public void Register(IUplinkHost host) { }

            public IReadOnlyList<ModSetting> ListModSettings() => new[]
            {
                ModSetting.Bool("a", "A", ModSettingRefresh.Live),
                ModSetting.Bool("b", "B", ModSettingRefresh.Live),
            };

            public ModSettingValue ReadModSetting(string id) =>
                id == "a" ? throw new InvalidOperationException("reflection broke") : ModSettingValue.Of(3.0);
        }

        /// <summary>A list that breaks a rule costs the mod settings only: the uplink still registers, and the topic says why.</summary>
        [Theory]
        [InlineData("throws")]
        [InlineData("duplicate")]
        [InlineData("writableWithoutWriter")]
        public void ABrokenListCostsTheModSettingsAndSaysWhy(string how)
        {
            var uplink = new ModUplink("survival");
            uplink.ListOverride = how switch
            {
                "throws" => () => throw new InvalidOperationException("list typo"),
                "duplicate" => () => new[] { Wear, Wear },
                _ => () => new[] { Throttle },
            };

            var (engine, _) = Discover(uplink);
            engine.SampleModSettings("FLIGHT/1");

            Assert.True(engine.IsUplinkRunning("survival"));
            var model = Model(engine, "survival");
            Assert.False(string.IsNullOrEmpty((string?)model["failure"]));
            Assert.Empty((List<object?>)model["settings"]!);
        }

        [Fact]
        public void AnUplinkWhoseIdWouldNameGonogosOwnSettingsTopicGetsNoModSettings()
        {
            var (engine, _) = Discover(new ModUplink(SettingsPublisher.CoreOwner, Wear));

            var model = (Dictionary<string, object?>)engine.PayloadOf(ChannelEngine.SettingsTopic)!;
            Assert.True(model.ContainsKey("rows"));
            Assert.False(model.ContainsKey("uplink"));
        }

        [Fact]
        public void AWriteReachesTheUplinkAndTheSettingIsReadAgainStraightAfter()
        {
            var uplink = new WritableModUplink("streamer", Throttle);
            uplink.Values["throttleMainRender"] = ModSettingValue.Of(false);
            var (engine, _) = Discover(uplink);
            engine.SampleModSettings("FLIGHT/1");

            var result = Write(engine, "streamer", "throttleMainRender", "True");

            Assert.True(result.Success);
            Assert.True(Assert.Single(uplink.Writes).Value.AsBool);
            Assert.Equal("True", Row(engine, "streamer", "throttleMainRender")["value"]);
            Assert.Equal(true, Row(engine, "streamer", "throttleMainRender")["writable"]);
        }

        /// <summary>The Uplink's refusal reaches the caller, and the topic still says what the mod holds.</summary>
        [Fact]
        public void AnUplinksRefusalIsReturnedAndWhatTheModHoldsIsRepublished()
        {
            var uplink = new WritableModUplink("streamer", Throttle)
            {
                Answer = CommandResult.Fail(CommandErrorCode.WrongScene, "not in flight"),
            };
            uplink.Values["throttleMainRender"] = ModSettingValue.Of(false);
            var (engine, _) = Discover(uplink);

            var result = Write(engine, "streamer", "throttleMainRender", "True");

            Assert.False(result.Success);
            Assert.Equal("not in flight", result.Detail);
            Assert.Equal("False", Row(engine, "streamer", "throttleMainRender")["value"]);
        }

        /// <summary>Gonogo never asks an Uplink to write what it did not offer, nor a value its kind cannot hold.</summary>
        [Theory]
        [InlineData("streamer", "throttleMainRender", "maybe")]
        [InlineData("streamer", "readOnly", "True")]
        [InlineData("streamer", "unlisted", "True")]
        [InlineData("nobody", "throttleMainRender", "True")]
        public void AWriteTheUplinkDidNotOfferIsRefusedWithoutAskingIt(string uplinkId, string id, string value)
        {
            var uplink = new WritableModUplink(
                "streamer", Throttle, ModSetting.Bool("readOnly", "Read only", ModSettingRefresh.Live));
            var (engine, _) = Discover(uplink);

            var result = Write(engine, uplinkId, id, value);

            Assert.False(result.Success);
            Assert.Empty(uplink.Writes);
        }

        [Fact]
        public void TheWriteCommandIsTrueNow()
        {
            Assert.True(CommandDelayCatalog.TryGetDelay(ChannelEngine.WriteModSettingCommand, out var delay));
            Assert.Equal(DelayRole.TrueNow, delay);
        }

        [Fact]
        public void TheTestUplinksMeetTheConformanceContract()
        {
            var survival = new ModUplink("survival", Reliability, Wear, Chance);
            survival.Values["reliability"] = ModSettingValue.Of(true);
            ModSettingsConformance.AssertSourceContract(survival);

            var streamer = new WritableModUplink("streamer", Throttle);
            streamer.Values["throttleMainRender"] = ModSettingValue.Of(true);
            ModSettingsConformance.AssertSourceContract(streamer);
            ModSettingsConformance.AssertWriterContract(streamer);
        }
    }
}
