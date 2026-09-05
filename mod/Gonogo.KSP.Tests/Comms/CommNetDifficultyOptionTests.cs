using System;
using System.Collections.Generic;
using System.Reflection;
using CommNet;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Xunit;

namespace Gonogo.KSP.Tests.Comms
{
    /// <summary>
    /// The CommNet difficulty option and everything gonogo hangs off it.
    ///
    /// <para><b>What cannot be reached here, stated plainly.</b> The live read
    /// itself, <c>CommsModelPresence.Present</c>, cannot be exercised with the
    /// option ON in any headless process. It goes through
    /// <c>HighLogic.CurrentGame</c>, which is a static PROPERTY over the
    /// <c>HighLogic</c> MonoBehaviour singleton: its getter returns null and
    /// its setter silently no-ops whenever <c>HighLogic.fetch</c> is null, and
    /// fetch is a Unity object whose implicit bool is false for anything not
    /// actually in a scene, so an uninitialised stand-in does not satisfy it
    /// either. Constructing the save is not the obstacle (a <c>Game</c> can be
    /// assembled, see the scope below); reaching the singleton is. So the
    /// option-on path is pinned against the SHIPPED BINARY instead, below, and
    /// the composition on top of it is driven through the probe seam.</para>
    ///
    /// <para>The composition that needs a live <c>Vessel</c> (CommNetBackend
    /// reading FlightGlobals) is covered from the other side in
    /// <c>Sitrep.Host.IntegrationTests.CommNetDisabledFreezeTests</c>, which
    /// drives the real reveal gate over a backend behaving exactly as stock's
    /// does once <c>CommNetScenario</c> has destroyed itself.</para>
    /// </summary>
    public class CommNetDifficultyOptionTests
    {
        /// <summary>
        /// The transcription pin, GENERATED from Assembly-CSharp rather than
        /// copied out of it: stock's own <c>CommNetScenario.CommNetEnabled</c>
        /// is walked at the IL level and the field it loads is compared to the
        /// one <c>CommsModelPresence.Present</c> reads. A hand-written
        /// assertion that the name is "EnableCommNet" would agree with itself
        /// forever; this disagrees the moment KSP moves the flag.
        /// </summary>
        [Fact]
        public void GonogoReadsTheSameFieldStocksOwnCommNetEnabledReads()
        {
            var stockReads = FieldsReadBy(
                typeof(CommNetScenario).GetProperty(
                    nameof(CommNetScenario.CommNetEnabled),
                    BindingFlags.Public | BindingFlags.Static)!.GetGetMethod()!);

            var flag = Assert.Single(
                stockReads,
                f => f.DeclaringType == typeof(GameParameters.DifficultyParams));

            Assert.Equal("EnableCommNet", flag.Name);
            Assert.Equal(typeof(bool), flag.FieldType);

            // And it is reachable by the exact chain CommsModelPresence walks.
            // Compiling that walk is what proves the shape; this proves the
            // walk lands on the same field stock does.
            Assert.Equal(
                typeof(GameParameters.DifficultyParams),
                typeof(GameParameters).GetField(nameof(GameParameters.Difficulty))!.FieldType);
            Assert.Equal(
                typeof(GameParameters),
                typeof(Game).GetField(nameof(Game.Parameters))!.FieldType);
        }

        /// <summary>
        /// The fail-soft arm, and the one live path a headless process really
        /// does take: no save loaded reads as UNKNOWN, where stock's own
        /// accessor collapses it to false. Stock can afford that (nothing is
        /// flying at the main menu); gonogo cannot, because a false switches
        /// the delay off and declares every craft connected, and a null game is
        /// not evidence for either.
        /// </summary>
        [Fact]
        public void NoSaveLoaded_IsUnknownRatherThanNoCommsModel()
        {
            Assert.Null(HighLogic.CurrentGame);
            Assert.Null(CommsModelPresence.Present);
        }

        /// <summary>
        /// A save CAN be assembled headlessly even though it cannot be
        /// installed, so the option's own storage is exercised rather than
        /// assumed: it is a plain public bool on a plain class, and setting it
        /// is what a difficulty preset and the in-game difficulty dialog both
        /// do.
        /// </summary>
        [Theory]
        [InlineData(true)]
        [InlineData(false)]
        public void TheOptionIsPlainPerSaveState(bool enabled)
        {
            var game = AssembleSave(enabled);

            Assert.Equal(enabled, game.Parameters.Difficulty.EnableCommNet);
        }

        /// <summary>
        /// The whole delay surface reads one accessor
        /// (<c>CommsCoreUplink.SignalDelayConfig</c>), so the option has to
        /// reach it: the reveal gate, comms.delay, every fleet vessel's
        /// light-time, the command-centre pass and the currency deadline all
        /// cut together or the board is inconsistent with itself.
        /// </summary>
        [Fact]
        public void TheOptionOff_CutsTheDelayEverySurfaceReads()
        {
            WithDelayOn(() =>
            {
                CommsCoreUplink.ConfigureCommsModelProbe(() => true);
                Assert.True(CommsCoreUplink.SignalDelayConfig.Enabled);
                Assert.False(CommsCoreUplink.SignalDelayConfig.CutForNoCommsModel);

                CommsCoreUplink.ConfigureCommsModelProbe(() => false);
                Assert.False(CommsCoreUplink.SignalDelayConfig.Enabled);
                Assert.True(CommsCoreUplink.SignalDelayConfig.CutForNoCommsModel);

                // The authored config is untouched: the cut is a derivation for
                // as long as this save is loaded, never an edit that would
                // leave delay off on the next one.
                Assert.True(CommsCoreUplink.AuthoredSignalDelayConfig.Enabled);
            });
        }

        /// <summary>
        /// Unknown changes nothing, which is what keeps a pre-save tick (or a
        /// read that threw) from switching a real career's delay off.
        /// </summary>
        [Fact]
        public void AnUnknownOptionLeavesTheDelayAlone()
        {
            WithDelayOn(() =>
            {
                CommsCoreUplink.ConfigureCommsModelProbe(() => null);

                Assert.True(CommsCoreUplink.SignalDelayConfig.Enabled);
            });
        }

        [Fact]
        public void AThrowingProbeLeavesTheDelayAlone()
        {
            WithDelayOn(() =>
            {
                CommsCoreUplink.ConfigureCommsModelProbe(() => throw new InvalidOperationException("no game"));

                Assert.True(CommsCoreUplink.SignalDelayConfig.Enabled);
            });
        }

        /// <summary>
        /// The single seam every comms reader in the uplink goes through, so
        /// the reveal gate's connectivity source, the comms.* channels and the
        /// delay source cannot come to disagree about whether there is a link.
        ///
        /// <para>Driven against a backend standing in for stock's own once
        /// <c>CommNetScenario</c> has destroyed itself: disconnected, no
        /// control, empty path, forever. The reading it produces has to be
        /// CONNECTED, and a false is what froze every Delayed channel for the
        /// session.</para>
        /// </summary>
        [Fact]
        public void TheOptionOff_TurnsADeadCommNetGraphIntoAConnectedReading()
        {
            var uplink = RegisteredUplink(new DeadGraphBackend());

            CommsCoreUplink.ConfigureCommsModelProbe(() => true);
            try
            {
                // Baseline: with a comms model, the dead graph is read
                // literally and reports a craft with no link home. That is
                // correct for a real blackout, and it is what a save with the
                // option off was getting for the whole session.
                Assert.False(uplink.ElectedBackend()!.Connectivity().Connected);

                CommsCoreUplink.ConfigureCommsModelProbe(() => false);
                var reading = uplink.ElectedBackend()!;
                Assert.True(reading.Connectivity().Connected);
                // And it stops blaming a connection that was never modelled.
                Assert.NotEqual("no connection to a command source", reading.ControlState().Reason);
            }
            finally
            {
                CommsCoreUplink.ConfigureCommsModelProbe(null);
            }
        }

        /// <summary>
        /// The delay the gate is handed, through the same composition: a KNOWN
        /// zero naming its own reason, not the null a craft with no measurable
        /// path reports.
        /// </summary>
        [Fact]
        public void TheOptionOff_HandsTheGateAKnownZeroRatherThanAnUnmeasurableDelay()
        {
            var uplink = RegisteredUplink(new DeadGraphBackend());

            WithDelayOn(() =>
            {
                CommsCoreUplink.ConfigureCommsModelProbe(() => true);
                var blackout = uplink.ComputeDelayOnMain(null);
                Assert.Null(blackout!.OneWaySeconds);
                Assert.Equal(CommsDelaySource.None, blackout.Source);

                CommsCoreUplink.ConfigureCommsModelProbe(() => false);
                var noModel = uplink.ComputeDelayOnMain(null);
                Assert.Equal(0.0, noModel!.OneWaySeconds);
                Assert.Equal(CommsDelaySource.NoCommsModel, noModel.Source);
            });
        }

        /// <summary>
        /// The per-vessel half. Every fleet craft keys its own reveal gate on
        /// its own connectivity, so a fleet read that still walked the dead
        /// CommNet graph would freeze each craft's <c>fleet.&lt;guid&gt;.*</c>
        /// individually even with the active vessel's gate open.
        ///
        /// <para>Read off the SHIPPED SOURCE, because the value cannot be
        /// reached: <c>ReadVessel</c> takes a live <c>Vessel</c>, which is a
        /// MonoBehaviour, and a stand-in built without a scene compares equal
        /// to null through Unity's own operator, so it takes the no-craft arm
        /// rather than the one under test. What IS checkable is that the cut
        /// happens BEFORE the CommNet walk, which is the whole of the wiring:
        /// the walk answers disconnected for every craft on such a save, so a
        /// cut placed after it would never be reached.</para>
        /// </summary>
        [Fact]
        public void TheOptionOff_CutsTheFleetReadBeforeItWalksTheCommNetGraph()
        {
            var source = CurrencyDelay.CurrencyDelaySourceText.ReadRelative("FleetCommsReader.cs");

            var cut = source.IndexOf("CutForNoCommsModel", StringComparison.Ordinal);
            var walk = source.IndexOf("vessel.connection", StringComparison.Ordinal);

            Assert.True(cut >= 0, "FleetCommsReader no longer consults the no-comms-model cut at all");
            Assert.True(walk >= 0, "FleetCommsReader no longer walks vessel.connection: this pin needs rewriting");
            Assert.True(cut < walk, "the no-comms-model cut must come before the CommNet walk, which answers disconnected for every craft on such a save");
        }

        [Fact]
        public void TheOptionOff_SaysSoInHealthRatherThanReportingAnUnqualifiedHealthyLink()
        {
            var uplink = RegisteredUplink(new DeadGraphBackend());

            CommsCoreUplink.ConfigureCommsModelProbe(() => false);
            try
            {
                var health = uplink.Health();

                Assert.Equal(UplinkHealthState.Healthy, health.State);
                Assert.Contains("CommNet off", health.Detail);
            }
            finally
            {
                CommsCoreUplink.ConfigureCommsModelProbe(null);
            }
        }

        /// <summary>
        /// A <see cref="CommsCoreUplink"/> whose capability has been declared
        /// and resolved, so <see cref="CommsElection.Elected"/> hands back the
        /// vanilla CommNetBackend, and whose kernel is bound: the same two
        /// steps <c>GonogoAddon</c> performs, against a host that records
        /// nothing.
        /// </summary>
        /// <param name="backend">
        /// Elected in place of the vanilla CommNetBackend, whose every read
        /// goes through FlightGlobals and whose own fail-soft cannot survive a
        /// headless process (its <c>Debug.LogWarning</c> throws a
        /// SecurityException with no Unity player behind it). What stands in
        /// for it is what stock's object graph actually reports on such a save.
        /// </param>
        private static CommsCoreUplink RegisteredUplink(ICommsBackend backend)
        {
            var uplink = new CommsCoreUplink();
            var kernel = new Kernel();
            uplink.DeclareCapabilities(kernel);
            kernel.RegisterProvider(new ProviderRegistration
            {
                Capability = CommsElection.CapabilityId,
                Id = backend.ProviderId,
                Priority = 10.0,
                Factory = _ => backend,
            });
            kernel.Resolve(new ResolveOptions { KernelVersion = "2.2.0" });
            uplink.Register(new NoOpUplinkHost(kernel));
            return uplink;
        }

        /// <summary>
        /// What stock's own object graph reports once the CommNet difficulty
        /// option is off: <c>CommNetScenario.OnAwake</c> destroys itself, so no
        /// <c>CommNetNetwork</c> is ever built, no vessel's <c>IsConnected</c>
        /// is ever assigned, and every <c>ControlPath</c> stays empty for the
        /// whole session. Not a pessimistic stand-in, the actual readings.
        /// </summary>
        private sealed class DeadGraphBackend : ICommsBackend
        {
            public string ProviderId => "commnet";

            public CommsConnectivity Connectivity() => new CommsConnectivity
            {
                Connected = false,
                ControlSource = CommsControlSource.None,
                HasLocalControl = false,
                Meta = new PayloadMeta { Source = "vessel:x", Quality = Quality.Loaded },
            };

            public CommsSignalStrength SignalStrength() => new CommsSignalStrength { Value = 0.0 };

            public CommsControlState ControlState() => new CommsControlState
            {
                State = CommsControlStateKind.None,
                Reason = "no connection to a command source",
            };

            public CommsPath Path() => new CommsPath { Hops = new List<CommsHop>() };

            public CommsNetwork Network() => new CommsNetwork();

            public ICommsOcclusionModel OcclusionModel() => CommsOcclusionModels.Unknown;

            // The graph is dead, so there is no route, nothing rated the pair,
            // and no path terminated anywhere. Three nulls and an Unknown, which
            // is what a backend that cannot answer is contractually required to
            // say rather than guessing.
            public IReadOnlyList<CommsRouteHop>? RouteBetween(object? from, object? to) => null;

            public ICommsReachModel ReachModel(object? from, object? to) => CommsReachModels.Unknown;

            public object? ControlPathTerminus() => null;
        }

        /// <summary>
        /// Accepts every registration <see cref="CommsCoreUplink.Register"/>
        /// makes and remembers none of them: what these cases read is the
        /// uplink's own capture closures afterwards, not what it handed over.
        /// The members it does not owe throw, so a registration that starts
        /// depending on one fails loudly rather than on a guessed default.
        /// </summary>
        private sealed class NoOpUplinkHost : IUplinkHost
        {
            internal NoOpUplinkHost(Kernel kernel) => Kernel = kernel;

            public Kernel Kernel { get; }

            public IChannelPublisher Publisher(string topic) => new NullPublisher();

            public void AddSampledSource(Func<KspSnapshot?, object?> captureOnMainThread, Action<object?> handleOnCourier)
            {
            }

            public void AddSampledSource(Func<KspSnapshot?, object?> captureOnMainThread, Action<object?> handleOnCourier, params string[] subscriptionTopicPrefixes)
            {
            }

            public void AddCommandHandler<TArgs, TResult>(string command, Func<TArgs, TResult> handler)
            {
            }

            public void SetSignalDelaySource(Func<KspSnapshot?, CommsDelay?> computeOnMainThread)
            {
            }

            public void SetConnectivitySource(Func<KspSnapshot?, bool?> computeOnMainThread)
            {
            }

            public IDynamicChannelSource RegisterDynamicNamespace(string prefix, ChannelDeclaration template) =>
                new NullDynamicSource();

            public double NowUt() => 0.0;
            public void AddSampler(ISnapshotSampler sampler) => throw new NotSupportedException();
            public void AddChannelSource(string topic, Func<KspSnapshot?, object?> map) => throw new NotSupportedException();
            public bool IsAnyTopicSubscribed(string topicPrefix) => throw new NotSupportedException();
            public void AddVantageCommandHandler<TArgs, TResult>(string command, Func<TArgs, string, TResult> handler) => throw new NotSupportedException();
            public void AddGateEvaluator(ICommandGateEvaluator evaluator) => throw new NotSupportedException();
            public void AddCommandRequirement(string command, CommandRequirement requirement) => throw new NotSupportedException();
            public void SetVesselDelay(string vesselId, double oneWaySeconds) => throw new NotSupportedException();
            public void SetAuthorityDelay(string centreId, string vesselId, double oneWaySeconds) => throw new NotSupportedException();
            public void SetCentreDelay(string fromCentreId, string toCentreId, double oneWaySeconds) => throw new NotSupportedException();
            public void SetVesselConnectivity(string vesselId, bool connected) => throw new NotSupportedException();
            public void SetAvailability(Availability availability) => throw new NotSupportedException();
            public void ForceKeyframe(string topic) => throw new NotSupportedException();
            public void ResetChannelBirth(IEnumerable<string> topics) => throw new NotSupportedException();

            private sealed class NullPublisher : IChannelPublisher
            {
                public void Publish(object? payload, double ut)
                {
                }
            }

            private sealed class NullDynamicSource : IDynamicChannelSource
            {
                public IChannelPublisher Publisher(string subTopic) => new NullPublisher();

                public void OnSubscribed(Action<string> callback)
                {
                }
            }
        }

        /// <summary>
        /// Every field an IL body LOADS, resolved through the declaring
        /// module's metadata. Enough for the one question here (which storage
        /// does stock's accessor actually read), and deliberately not a general
        /// disassembler: it walks the single-byte opcodes it needs and skips
        /// the rest by operand width.
        /// </summary>
        private static IReadOnlyList<FieldInfo> FieldsReadBy(MethodInfo method)
        {
            var il = method.GetMethodBody()!.GetILAsByteArray()!;
            var module = method.Module;
            var read = new List<FieldInfo>();

            for (var i = 0; i < il.Length;)
            {
                var opcode = il[i];
                // 0x7B ldfld, 0x7E ldsfld: both take a 4-byte field token.
                if (opcode == 0x7B || opcode == 0x7E)
                {
                    var field = module.ResolveField(BitConverter.ToInt32(il, i + 1));
                    if (field != null)
                    {
                        read.Add(field);
                    }
                    i += 5;
                    continue;
                }
                // 0x45 switch: a 4-byte case count followed by that many
                // 4-byte targets. Present here because KSP ships obfuscated,
                // and its control-flow flattening puts a switch in the middle
                // of even a two-field property getter.
                if (opcode == 0x45)
                {
                    var cases = BitConverter.ToInt32(il, i + 1);
                    i += 5 + (4 * cases);
                    continue;
                }
                i += OperandWidth(opcode) + 1;
            }

            return read;
        }

        /// <summary>
        /// Operand width in bytes, for the opcodes this walk meets. Anything
        /// unlisted is treated as operand-free, which is true of the whole
        /// single-byte stack-manipulation range; a wider opcode misread that
        /// way desynchronises the walk and shows up as a resolve failure or a
        /// missing field rather than as a quiet pass, which is why the case
        /// this pin exists for asserts on exactly one field.
        /// </summary>
        private static int OperandWidth(byte opcode) => opcode switch
        {
            // ldarg.s / ldarga.s / starg.s / ldloc.s / ldloca.s / stloc.s, ldc.i4.s
            0x0E or 0x0F or 0x10 or 0x11 or 0x12 or 0x13 or 0x1F => 1,
            // the short-form branches
            >= 0x2B and <= 0x37 => 1,
            // ldc.i4 / ldc.r4, the long-form branches, calls and metadata tokens
            0x20 or 0x22 => 4,
            >= 0x38 and <= 0x44 => 4,
            0x28 or 0x29 or 0x6F or 0x70 or 0x71 or 0x72 or 0x73 or 0x74 or 0x75
                or 0x79 or 0x7B or 0x7C or 0x7D or 0x7E or 0x7F or 0x80 or 0x81
                or 0x8C or 0x8D or 0x8F or 0xA2 or 0xA3 or 0xA4 or 0xA5 or 0xC2
                or 0xC6 or 0xD0 => 4,
            // ldc.i8 / ldc.r8
            0x21 or 0x23 => 8,
            // the 0xFE prefix: a second opcode byte, and the two-byte forms
            // this walk can meet carry no further operand.
            0xFE => 1,
            _ => 0,
        };

        /// <summary>
        /// A save assembled rather than constructed. <c>new Game()</c> reaches
        /// GameDatabase, ExpansionsLoader and KerbalRoster and fires a
        /// GameEvent, none of which exist outside a running player, so the
        /// object is allocated uninitialised and given the one field this
        /// question needs. <c>GameParameters</c> itself is constructed for real
        /// (it is what owns <c>Difficulty</c>), which needs
        /// <c>AssemblyLoader.loadedAssemblies</c> to be a list rather than
        /// null: its static constructor scans every loaded assembly for custom
        /// parameter nodes, and an empty list is a scan that finds none.
        /// </summary>
        private static Game AssembleSave(bool enableCommNet)
        {
            AssemblyLoader.loadedAssemblies ??= new AssemblyLoader.LoadedAssembyList();

            var game = (Game)System.Runtime.CompilerServices.RuntimeHelpers
                .GetUninitializedObject(typeof(Game));
            game.Parameters = new GameParameters();
            game.Parameters.Difficulty.EnableCommNet = enableCommNet;
            return game;
        }

        /// <summary>
        /// The config, the kernel and the model probe behind the shared delay
        /// accessor are all process statics, so a case that left any of them
        /// set would change the answer for whatever ran next.
        /// </summary>
        private static void WithDelayOn(Action body)
        {
            var authored = CommsCoreUplink.AuthoredSignalDelayConfig;
            try
            {
                CommsCoreUplink.ConfigureSignalDelay(new SignalDelayConfig
                {
                    Enabled = true,
                    LightSpeedScale = 1.0,
                });
                body();
            }
            finally
            {
                CommsCoreUplink.ConfigureCommsModelProbe(null);
                CommsCoreUplink.ConfigureSimulationKernel(null);
                CommsCoreUplink.ConfigureSignalDelay(authored);
            }
        }
    }
}
