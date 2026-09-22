using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host;
using Sitrep.Host.CommandCentres;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// The engine can say "that is not a place" and "I do not know what places
    /// there are", and they are different answers.
    ///
    /// <para><see cref="ChannelEngine.IsVantageSelectable"/> answers null for the
    /// second, and an alarm's arm refuses each with its own message. The
    /// distinction only means anything if the NULL genuinely comes off the engine
    /// in the state that produces it, so these tests take it from a real engine
    /// rather than from a caller's own <c>null</c>: a rule exercised only against
    /// a hand-made value proves the rule and nothing about the instrument feeding
    /// it.</para>
    /// </summary>
    public class SelectableVantageKnowledgeTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);

        private const string Centre = "ground:Kerbal Space Center";

        /// <summary>
        /// Before any tick, and at the main menu where no game is loaded, the
        /// selectable set is empty. Nothing is known, so nothing can be denied.
        /// </summary>
        [Fact]
        public void NoPlaceIsKnownBeforeTheFirstCapture()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterCommandCentreSource(new GroundSource(Centre));
            // Started, so this is a live engine that has not ticked rather than
            // one that was never running: the source below would find the centre
            // the moment a capture ran, and has not been asked.
            engine.Start();
            try
            {
                Assert.Null(engine.IsVantageSelectable(Centre));
                Assert.Null(engine.IsVantageSelectable("ground:Nowhere"));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// Once a capture has run, the same two questions get real answers, and
        /// the one that is not a place answers FALSE rather than null. That is
        /// what makes the earlier null a statement about the engine's knowledge
        /// rather than about this id.
        /// </summary>
        [Fact]
        public void OnceAPlaceIsKnownTheAnswersAreRealOnesEitherWay()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterCommandCentreSource(new GroundSource(Centre));
            engine.Start();
            try
            {
                engine.TickAndWait(0.0, null, Timeout);

                Assert.True(engine.IsVantageSelectable(Centre));
                Assert.False(engine.IsVantageSelectable("ground:Nowhere"));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A source that finds nothing leaves the set empty, which is the main
        /// menu: a tick has run and there is still nothing to know. The answer
        /// stays null rather than becoming "no such place", because a tick having
        /// happened is not the same as places having been found.
        /// </summary>
        [Fact]
        public void ATickThatFindsNoPlacesStillKnowsNothing()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterCommandCentreSource(new GroundSource());
            engine.Start();
            try
            {
                engine.TickAndWait(0.0, null, Timeout);

                Assert.Null(engine.IsVantageSelectable(Centre));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>Ground stations under whatever ids the test gave it.</summary>
        private sealed class GroundSource : ICommandCentreSource
        {
            private readonly string[] _ids;

            public GroundSource(params string[] ids) => _ids = ids;

            public string ProviderId => "selectable-vantage-test";

            public IEnumerable<ICommandCentre> Enumerate()
            {
                foreach (var id in _ids)
                {
                    yield return new Centre(id);
                }
            }

            private sealed class Centre : ICommandCentre
            {
                public Centre(string id) => Id = id;

                public string Id { get; }
                public string DisplayName => Id;
                public CommandCentreKind Kind => CommandCentreKind.GroundStation;
                public int? BodyIndex => null;
                public double? Latitude => null;
                public double? Longitude => null;
                public bool IsActiveNow() => true;
            }
        }
    }
}
