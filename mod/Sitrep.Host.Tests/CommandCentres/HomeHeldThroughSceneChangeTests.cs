using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host.CommandCentres;
using Xunit;

namespace Sitrep.Host.Tests.CommandCentres
{
    /// <summary>
    /// While the game is changing scene the homes it can name are not the homes
    /// it has, so the election is not re-run: the last answer stands until the
    /// scene can be read again.
    /// </summary>
    public class HomeHeldThroughSceneChangeTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(5);

        private static readonly IReadOnlyList<HomeNodeFacts> Settled = new[]
        {
            new HomeNodeFacts(true, "Kerbal Space Center"),
            new HomeNodeFacts(false, "Baikerbanur"),
        };

        private static readonly IReadOnlyList<HomeNodeFacts> Mid = new[]
        {
            new HomeNodeFacts(true, "Baikerbanur"),
        };

        [Fact]
        public void HomeDoesNotMoveWhileTheSceneCannotBeRead()
        {
            var homes = Settled;
            var readable = true;
            using var engine = new ChannelEngine("ws://127.0.0.1:0");
            HomeCommandElection.RegisterCapability(engine.Kernel, () => homes, () => null);
            engine.SetHomeReadable(() => readable);
            engine.ResolveCapabilities();
            engine.Start();
            try
            {
                engine.TickAndWait(1, new KspSnapshot { Ut = 1 }, Timeout);
                var before = engine.CurrentHomeCommand;
                Assert.Equal(HomeCentreIds.Mint(Settled)[0], before.CentreId);

                readable = false;
                homes = Mid;
                engine.TickAndWait(2, new KspSnapshot { Ut = 2 }, Timeout);
                Assert.Equal(before.CentreId, engine.CurrentHomeCommand.CentreId);

                readable = true;
                engine.TickAndWait(3, new KspSnapshot { Ut = 3 }, Timeout);
                Assert.Equal(HomeCentreIds.Mint(Mid)[0], engine.CurrentHomeCommand.CentreId);
            }
            finally
            {
                engine.Stop();
            }
        }
    }
}
