using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Sitrep.Host.BodyTextures;
using Xunit;

namespace Sitrep.Host.Tests.BodyTextures
{
    public sealed class BodyTextureServerTests : IDisposable
    {
        private readonly string _directory = Path.Combine(Path.GetTempPath(), "gonogo-bodytex-" + Guid.NewGuid().ToString("N"));

        public void Dispose()
        {
            if (Directory.Exists(_directory))
            {
                Directory.Delete(_directory, true);
            }
        }

        private static BodyTextureDescription Mun(string name = "NewMunSurfaceMapDiffuse", int width = 4096, int height = 2048, string format = "DXT1", int mips = 13) =>
            new BodyTextureDescription("Mun", name, width, height, format, mips);

        /* Work runs at once on the calling thread, so a test steps the server tick by tick with no waiting. */
        private static Task<byte[]?> Inline(Func<byte[]?> work) => Task.FromResult(work());

        private BodyTextureServer Server(FakeSource source, List<string>? log = null) =>
            new BodyTextureServer(source, new BodyTextureCache(_directory), Inline, log == null ? null : log.Add);

        private static List<BodyTextureResult> TickUntilReady(BodyTextureServer server, int most = 20)
        {
            var ready = new List<BodyTextureResult>();
            for (var i = 0; i < most && ready.Count == 0; i++)
            {
                ready.AddRange(server.Tick(i));
            }
            return ready;
        }

        [Fact]
        public void TheCacheKeyMovesWithEverythingThatChangesTheBytes()
        {
            var key = BodyTextureCache.Key(Mun(), 2048, 1024);

            Assert.Matches("^[0-9a-f]{16}$", key);
            Assert.Equal(key, BodyTextureCache.Key(Mun(), 2048, 1024));
            Assert.NotEqual(key, BodyTextureCache.Key(Mun(name: "packMun"), 2048, 1024));
            Assert.NotEqual(key, BodyTextureCache.Key(Mun(width: 8192, height: 4096), 2048, 1024));
            Assert.NotEqual(key, BodyTextureCache.Key(Mun(format: "BC7"), 2048, 1024));
            Assert.NotEqual(key, BodyTextureCache.Key(Mun(mips: 12), 2048, 1024));
            Assert.NotEqual(key, BodyTextureCache.Key(Mun(), 1024, 512));
            Assert.NotEqual(key, BodyTextureCache.Key(new BodyTextureDescription("Minmus", "NewMunSurfaceMapDiffuse", 4096, 2048, "DXT1", 13), 2048, 1024));
        }

        [Theory]
        [InlineData(8192, 4096, 4096, 2048)]
        [InlineData(16384, 8192, 4096, 2048)]
        [InlineData(4096, 2048, 4096, 2048)]
        [InlineData(2048, 1024, 2048, 1024)]
        [InlineData(6000, 3000, 3000, 1500)]
        public void AMapIsHalvedUntilItFitsAndNeverScaledUp(int width, int height, int outWidth, int outHeight)
        {
            Assert.Equal((outWidth, outHeight), BodyTextureServer.OutputSize(width, height));
        }

        [Fact]
        public void AMapNotInTheCacheIsReadFromTheCardOnceThenCached()
        {
            var source = new FakeSource { ["Mun"] = Mun(width: 4, height: 2) };
            var server = Server(source);

            server.Ask("Mun");
            var ready = TickUntilReady(server);

            var result = Assert.Single(ready);
            Assert.Equal("Mun", result.Body);
            Assert.NotNull(result.Png);
            Assert.Equal(1, server.CardReads);
            var image = BodyTexturePngTests.PngReader.Read(result.Png!);
            Assert.Equal(4, image.Width);
            var cached = Directory.GetFiles(_directory);
            Assert.Equal(result.Png, File.ReadAllBytes(Assert.Single(cached)));
        }

        [Fact]
        public void ACachedMapIsServedWithoutTouchingTheCard()
        {
            var source = new FakeSource { ["Mun"] = Mun(width: 4, height: 2) };
            var first = Server(source);
            first.Ask("Mun");
            var made = Assert.Single(TickUntilReady(first)).Png;

            var nextGame = Server(source);
            nextGame.Ask("Mun");
            var served = Assert.Single(TickUntilReady(nextGame));

            Assert.Equal(made, served.Png);
            Assert.Equal(0, nextGame.CardReads);
            Assert.Equal(1, source.ReadsBegun);
        }

        [Fact]
        public void AChangedTextureIsReadAgainAndItsOldCopyDeleted()
        {
            var source = new FakeSource { ["Mun"] = Mun(width: 4, height: 2) };
            var first = Server(source);
            first.Ask("Mun");
            TickUntilReady(first);
            var oldFile = Assert.Single(Directory.GetFiles(_directory));

            source["Mun"] = Mun(name: "packMun", width: 4, height: 2);
            var nextGame = Server(source);
            nextGame.Ask("Mun");
            Assert.NotNull(Assert.Single(TickUntilReady(nextGame)).Png);

            Assert.Equal(1, nextGame.CardReads);
            var newFile = Assert.Single(Directory.GetFiles(_directory));
            Assert.NotEqual(oldFile, newFile);
        }

        [Fact]
        public void ABodyWithNoMapIsAnsweredWithNoneAndSaysWhy()
        {
            var log = new List<string>();
            var server = Server(new FakeSource(), log);

            server.Ask("Sun");
            var result = Assert.Single(server.Tick(0));

            Assert.Equal("Sun", result.Body);
            Assert.Null(result.Png);
            Assert.Contains(log, line => line.Contains("Sun") && line.Contains(FakeSource.NoMap));
        }

        [Fact]
        public void ABodyIsServedOnceHoweverOftenItIsAskedFor()
        {
            var source = new FakeSource { ["Mun"] = Mun(width: 4, height: 2) };
            var server = Server(source);

            server.Ask("Mun");
            server.Ask("Mun");
            var ready = new List<BodyTextureResult>();
            for (var i = 0; i < 20; i++)
            {
                ready.AddRange(server.Tick(i));
                server.Ask("Mun");
            }

            Assert.Single(ready);
            Assert.Equal(1, source.ReadsBegun);
        }

        [Fact]
        public void OneMapIsReadFromTheCardAtATimeAStripPerTick()
        {
            var source = new FakeSource { ["Mun"] = Mun(width: 4, height: 2), ["Ike"] = new BodyTextureDescription("Ike", "ike", 4, 2, "DXT1", 1) };
            var server = Server(source);

            server.Ask("Mun");
            server.Ask("Ike");
            var finishedAt = new Dictionary<string, int>();
            for (var tick = 0; tick < 20 && finishedAt.Count < 2; tick++)
            {
                foreach (var r in server.Tick(tick))
                {
                    finishedAt[r.Body] = tick;
                }
                Assert.True(source.OpenReads <= 1);
            }

            Assert.Equal(2, finishedAt.Count);
            Assert.True(Math.Abs(finishedAt["Mun"] - finishedAt["Ike"]) >= FakeSource.Strips);
            Assert.Equal(2, source.ReadsBegun);
            Assert.Equal(0, source.OpenReads);
        }

        [Fact]
        public void AReadThatFailsAnswersWithNoneAndCachesNothing()
        {
            var log = new List<string>();
            var source = new FakeSource { ["Mun"] = Mun(width: 4, height: 2), FailReads = true };
            var server = Server(source, log);

            server.Ask("Mun");
            var result = Assert.Single(TickUntilReady(server));

            Assert.Null(result.Png);
            Assert.False(Directory.Exists(_directory) && Directory.GetFiles(_directory).Length > 0);
            Assert.Contains(log, line => line.Contains("could not be read"));
            Assert.Equal(0, source.OpenReads);
        }

        [Theory]
        [InlineData("Kerbin", "Kerbin")]
        [InlineData("Gael's Moon", "Gael%27s%20Moon")]
        public void ABodyNameIsOneTopicSegmentAndParsesBack(string body, string key)
        {
            Assert.Equal(key, BodyTextureWire.Key(body));
            Assert.Equal(BodyTextureWire.Prefix + key, BodyTextureWire.Topic(body));
            Assert.True(BodyTextureWire.TryParseKey(key, out var parsed));
            Assert.Equal(body, parsed);
        }

        [Fact]
        public void ARequestMadeBeforeTheGameHasBuiltItsBodiesWaitsAndIsServedOnceItHas()
        {
            var source = new FakeSource { BodiesLoaded = false };
            source["Mun"] = Mun(width: 64, height: 32);
            var log = new List<string>();
            var server = Server(source, log);

            server.Ask("Mun");
            for (var i = 0; i < 10; i++)
            {
                Assert.Empty(server.Tick(i));
            }
            Assert.Equal(0, source.ReadsBegun);
            Assert.Single(log, line => line.StartsWith("waiting for the game to build its bodies"));
            Assert.DoesNotContain(log, line => line.StartsWith("no map for"));

            source.BodiesLoaded = true;
            var ready = Assert.Single(TickUntilReady(server));
            Assert.Equal("Mun", ready.Body);
            Assert.NotNull(ready.Png);
        }

        [Fact]
        public void AReadTakesOneStripPerTickAndLogsTheWorstFrameWhileItRan()
        {
            var source = new FakeSource();
            source["Mun"] = Mun(width: 64, height: 32);
            var log = new List<string>();
            var server = Server(source, log);

            server.Ask("Mun");
            Assert.Empty(server.Tick(10.000));
            Assert.Empty(server.Tick(10.016));
            Assert.Empty(server.Tick(10.216));
            Assert.Single(server.Tick(10.232));

            var read = Assert.Single(log, line => line.StartsWith("read the map of Mun"));
            Assert.Contains("over " + FakeSource.Strips + " frames: worst frame 200 ms", read);
        }

        [Theory]
        [InlineData("")]
        [InlineData("Kerbin.extra")]
        [InlineData("bad%G1")]
        public void AKeyThatIsNotOneBodyIsRefused(string key)
        {
            Assert.False(BodyTextureWire.TryParseKey(key, out _));
        }

        private sealed class FakeSource : IBodyTextureSource
        {
            public const string NoMap = "it has no map";
            public const int Strips = 3;

            private readonly Dictionary<string, BodyTextureDescription> _bodies = new Dictionary<string, BodyTextureDescription>();

            public BodyTextureDescription this[string body]
            {
                set => _bodies[body] = value;
            }

            public bool FailReads { get; set; }

            public bool BodiesLoaded { get; set; } = true;

            public int ReadsBegun { get; private set; }

            public int OpenReads { get; private set; }

            public BodyTextureDescription? Describe(string body, out string reason)
            {
                reason = NoMap;
                return _bodies.TryGetValue(body, out var d) ? d : null;
            }

            public IBodyTextureRead BeginRead(BodyTextureDescription texture, int width, int height)
            {
                ReadsBegun++;
                OpenReads++;
                return new Read(this, width, height);
            }

            private sealed class Read : IBodyTextureRead
            {
                private readonly FakeSource _source;
                private readonly int _width;
                private readonly int _height;
                private int _strips;
                private bool _disposed;

                public Read(FakeSource source, int width, int height)
                {
                    _source = source;
                    _width = width;
                    _height = height;
                }

                public byte[] Rgba { get; private set; } = Array.Empty<byte>();

                public bool Advance()
                {
                    if (_source.FailReads)
                    {
                        throw new InvalidOperationException("the card went away");
                    }
                    if (++_strips < Strips)
                    {
                        return false;
                    }
                    Rgba = Enumerable.Range(0, _width * _height * 4).Select(i => (byte)i).ToArray();
                    return true;
                }

                public void Dispose()
                {
                    if (!_disposed)
                    {
                        _disposed = true;
                        _source.OpenReads--;
                    }
                }
            }
        }
    }
}
