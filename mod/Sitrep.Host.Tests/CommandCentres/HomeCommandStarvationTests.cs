using System;
using System.Collections.Generic;
using System.Threading;
using Sitrep.Contract;
using Sitrep.Host.CommandCentres;
using Xunit;

namespace Sitrep.Host.Tests.CommandCentres
{
    /// <summary>
    /// A home-command claimant registered by an Uplink is asked on every tick with
    /// nothing subscribed, through the real <see cref="ChannelEngine"/>.
    ///
    /// <para>Home decides where a connection that has not chosen a vantage stands,
    /// so it has to be answered before any client subscribes to anything. The
    /// engine asks the elected claimant from its own ungated command-centre capture;
    /// what can still starve it is a claimant whose answer is written by that
    /// Uplink's subscription-gated capture. Both shapes are planted here, the second
    /// to show this drive sees starvation when it is there, so the first passing is
    /// not a drive that could not have failed.</para>
    ///
    /// <para>Uplink-owned claimants carry their own case in their Tests project. This
    /// one uses a planted claimant, so the proof stays in this repo whichever
    /// Uplinks move out.</para>
    /// </summary>
    public class HomeCommandStarvationTests
    {
        // Claimed for the census in Sitrep.Host.IntegrationTests, which fails on an exclusive capability an Uplink can win that nothing claims.
        //
        // exclusive-capability-starvation: homeCommand

        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(5);

        private const string Station = "ground:Planted Station";

        private const string GatedPrefix = "planted.home.";

        [Fact]
        public void A_claimant_asked_when_identifying_answers_with_nothing_subscribed()
        {
            var uplink = new PlantedHomeUplink(Shape.AskedWhenIdentifying, gated: true);

            var home = DriveWithNothingSubscribed(uplink);

            Assert.Equal(0, uplink.GatedCaptures);
            Assert.True(home.IsIdentified, "the elected claimant was never asked, or its answer never reached CurrentHomeCommand");
            Assert.Equal(Station, home.CentreId);
        }

        [Fact]
        public void A_claimant_fed_by_a_gated_capture_is_starved_with_nothing_subscribed()
        {
            var uplink = new PlantedHomeUplink(Shape.FedByCapture, gated: true);

            var home = DriveWithNothingSubscribed(uplink);

            Assert.Equal(0, uplink.GatedCaptures);
            Assert.Same(HomeCommand.NotIdentified, home);
        }

        /// <summary>The same claimant fed by an ungated capture answers, so the gate alone starves the one above.</summary>
        [Fact]
        public void The_same_claimant_fed_by_an_ungated_capture_answers()
        {
            var uplink = new PlantedHomeUplink(Shape.FedByCapture, gated: false);

            var home = DriveWithNothingSubscribed(uplink);

            Assert.Equal(Station, home.CentreId);
        }

        /// <summary>
        /// Stock homes that identify nothing, one active ground station, the planted
        /// Uplink registered, and five ticks with no client connected.
        /// </summary>
        private static HomeCommand DriveWithNothingSubscribed(PlantedHomeUplink uplink)
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0");
            engine.RegisterCommandCentreSource(new OneGroundStation());
            HomeCommandElection.RegisterCapability(engine.Kernel, () => Array.Empty<HomeNodeFacts>());
            engine.RegisterUplink(uplink);
            engine.ResolveCapabilities();
            engine.Start();
            try
            {
                Assert.Equal(PlantedHomeUplink.ClaimantId, HomeCommandElection.Elected(engine.Kernel)?.ProviderId);

                for (var tick = 1; tick <= 5; tick++)
                {
                    engine.TickAndWait(tick, new KspSnapshot { Ut = tick }, Timeout);
                }

                return engine.CurrentHomeCommand;
            }
            finally
            {
                engine.Stop();
            }
        }

        private enum Shape
        {
            /// <summary>Reads the centres it is handed when asked: the safe shape.</summary>
            AskedWhenIdentifying,

            /// <summary>Answers with whatever its Uplink's capture last wrote: starved whenever that capture is skipped.</summary>
            FedByCapture,
        }

        private sealed class PlantedHomeUplink : ISitrepUplink
        {
            public const string ClaimantId = "planted-home";

            private readonly Shape _shape;
            private readonly bool _gated;
            private volatile string? _captured;
            private int _gatedCaptures;

            public PlantedHomeUplink(Shape shape, bool gated)
            {
                _shape = shape;
                _gated = gated;
            }

            public UplinkManifest Manifest { get; } = new UplinkManifest { Id = "planted.home", Version = "1.0.0" };

            /// <summary>How many times the gated capture ran, which with nothing subscribed must be none.</summary>
            public int GatedCaptures => Volatile.Read(ref _gatedCaptures);

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public void Register(IUplinkHost host)
            {
                Func<KspSnapshot?, object?> capture = _ =>
                {
                    if (_gated)
                    {
                        Interlocked.Increment(ref _gatedCaptures);
                    }

                    return Station;
                };
                Action<object?> handle = value => _captured = value as string;

                if (_gated)
                {
                    host.AddSampledSource(capture, handle, GatedPrefix);
                }
                else
                {
                    host.AddSampledSource(capture, handle);
                }

                host.Kernel.RegisterProvider(new ProviderRegistration
                {
                    Capability = HomeCommandCapability.Id,
                    Id = ClaimantId,
                    Priority = 10.0,
                    Factory = _ => new Claimant(_shape, () => _captured),
                });
            }
        }

        private sealed class Claimant : IHomeCommandProvider
        {
            private readonly Shape _shape;
            private readonly Func<string?> _captured;

            public Claimant(Shape shape, Func<string?> captured)
            {
                _shape = shape;
                _captured = captured;
            }

            public string ProviderId => PlantedHomeUplink.ClaimantId;

            public HomeCommand Identify(IReadOnlyList<ICommandCentre> activeCentres)
            {
                if (_shape == Shape.FedByCapture)
                {
                    var captured = _captured();
                    return captured == null ? HomeCommand.NotIdentified : HomeCommand.Identified(captured);
                }

                foreach (var centre in activeCentres)
                {
                    if (centre.Kind == CommandCentreKind.GroundStation)
                    {
                        return HomeCommand.Identified(centre.Id);
                    }
                }

                return HomeCommand.NotIdentified;
            }
        }

        private sealed class OneGroundStation : ICommandCentreSource, ICommandCentre
        {
            public string ProviderId => "planted-centres";

            public IEnumerable<ICommandCentre> Enumerate() => new ICommandCentre[] { this };

            public string Id => Station;
            public string DisplayName => Station;
            public CommandCentreKind Kind => CommandCentreKind.GroundStation;
            public int? BodyIndex => null;
            public double? Latitude => null;
            public double? Longitude => null;
            public bool IsActiveNow() => true;
        }
    }
}
