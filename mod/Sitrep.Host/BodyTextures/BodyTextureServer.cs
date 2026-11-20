using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Threading.Tasks;
using Sitrep.Contract;

namespace Sitrep.Host.BodyTextures
{
    /// <summary>One body's map, ready to send: the PNG, or null when the game has none to give for that body.</summary>
    public sealed class BodyTextureResult
    {
        public BodyTextureResult(string body, byte[]? png)
        {
            Body = body;
            Png = png;
        }

        public string Body { get; }

        public byte[]? Png { get; }
    }

    /// <summary>
    /// Serves each body's surface map once per game: from the disk cache when a
    /// copy made from the same texture is there, otherwise read back from the
    /// graphics card a strip per frame, one body at a time, then flipped and
    /// encoded on a worker and written to the cache. A cached map never touches
    /// the graphics card. A request made before the game has built its bodies
    /// waits until it has.
    ///
    /// <para><see cref="Tick"/> is meant to be called once per rendered frame,
    /// in every scene: the read takes one strip per call.</para>
    /// </summary>
    public sealed class BodyTextureServer
    {
        /*
         * 4096 by 2048 keeps a zoomed-in Ground Track as sharp as the body's
         * own art at the game's common size, at the cost of one larger transfer
         * per body: each body is sent once per connection and cached at both
         * ends. A source smaller than this is sent at its own size, never
         * scaled up; an 8192 source is halved.
         */
        public const int MaxWidth = 4096;
        public const int MaxHeight = 2048;

        private static readonly PerfBudget RequestBudget = new PerfBudget(
            "BodyTextureServer body maps requested", threshold: 30, windowSec: 1.0, unit: "requests");

        private static readonly PerfBudget GpuReadBudget = new PerfBudget(
            "BodyTextureServer body maps read from the graphics card", threshold: 2, windowSec: 1.0, unit: "maps");

        private readonly IBodyTextureSource _source;
        private readonly BodyTextureCache _cache;
        private readonly Func<Func<byte[]?>, Task<byte[]?>> _run;
        private readonly Action<string> _log;

        private readonly ConcurrentQueue<string> _asked = new ConcurrentQueue<string>();

        /* Main thread only, from here down. */
        private readonly HashSet<string> _started = new HashSet<string>(StringComparer.Ordinal);
        private readonly List<string> _waitingForBodies = new List<string>();
        private bool _toldWaiting;
        private double? _lastTick;
        private readonly List<Job> _probing = new List<Job>();
        private readonly Queue<Job> _waitingForCard = new Queue<Job>();
        private readonly List<Job> _encoding = new List<Job>();
        private Job? _reading;

        /// <param name="source">The game side.</param>
        /// <param name="cache">Where encoded maps are kept between games.</param>
        /// <param name="run">Runs work off the main thread; <c>Task.Run</c> when null.</param>
        /// <param name="log">Where a body with no map, or a cache that cannot be written, is reported.</param>
        public BodyTextureServer(
            IBodyTextureSource source,
            BodyTextureCache cache,
            Func<Func<byte[]?>, Task<byte[]?>>? run = null,
            Action<string>? log = null)
        {
            _source = source ?? throw new ArgumentNullException(nameof(source));
            _cache = cache ?? throw new ArgumentNullException(nameof(cache));
            _run = run ?? (work => Task.Run(work));
            _log = log ?? (_ => { });
        }

        /// <summary>How many maps have been read from the graphics card.</summary>
        public int CardReads { get; private set; }

        /// <summary>The size a <paramref name="width"/> by <paramref name="height"/> texture is sent at: halved until it fits <see cref="MaxWidth"/> by <see cref="MaxHeight"/>.</summary>
        public static (int Width, int Height) OutputSize(int width, int height)
        {
            while (width > MaxWidth || height > MaxHeight)
            {
                width = Math.Max(1, width / 2);
                height = Math.Max(1, height / 2);
            }
            return (width, height);
        }

        /// <summary>Asks for the map of the body named <paramref name="body"/>. Any thread; a body already asked for is served once.</summary>
        public void Ask(string body)
        {
            if (!string.IsNullOrEmpty(body))
            {
                _asked.Enqueue(body);
            }
        }

        /// <summary>
        /// MAIN-THREAD: takes new requests, moves each one on a step, and returns
        /// the maps that are now ready. <paramref name="now"/> is a clock in
        /// seconds that moves with real time: the performance budgets use it, and
        /// the gap between calls during a read is logged as the frame time.
        /// </summary>
        public List<BodyTextureResult> Tick(double now)
        {
            var frameMs = _lastTick.HasValue ? (now - _lastTick.Value) * 1000.0 : 0.0;
            _lastTick = now;

            var ready = new List<BodyTextureResult>();
            while (_asked.TryDequeue(out var body))
            {
                RequestBudget.Record(1, now);
                if (!_started.Add(body))
                {
                    continue;
                }
                _waitingForBodies.Add(body);
            }
            StartWaiting(ready);

            for (var i = _probing.Count - 1; i >= 0; i--)
            {
                var job = _probing[i];
                if (!job.Work!.IsCompleted)
                {
                    continue;
                }
                _probing.RemoveAt(i);
                var cached = job.Work.Status == TaskStatus.RanToCompletion ? job.Work.Result : null;
                if (cached != null)
                {
                    ready.Add(new BodyTextureResult(job.Texture.Body, cached));
                }
                else
                {
                    _waitingForCard.Enqueue(job);
                }
            }

            AdvanceRead(now, frameMs);

            for (var i = _encoding.Count - 1; i >= 0; i--)
            {
                var job = _encoding[i];
                if (!job.Work!.IsCompleted)
                {
                    continue;
                }
                _encoding.RemoveAt(i);
                if (job.Work.Status != TaskStatus.RanToCompletion)
                {
                    _log("the map of " + job.Texture.Body + " could not be encoded: " + job.Work.Exception?.GetBaseException().Message);
                    ready.Add(new BodyTextureResult(job.Texture.Body, null));
                    continue;
                }
                ready.Add(new BodyTextureResult(job.Texture.Body, job.Work.Result));
            }

            return ready;
        }

        /* Starts every request that came in before the game had built its bodies, once it has; until then says so once. */
        private void StartWaiting(List<BodyTextureResult> ready)
        {
            if (_waitingForBodies.Count == 0)
            {
                return;
            }
            if (!_source.BodiesLoaded)
            {
                if (!_toldWaiting)
                {
                    _toldWaiting = true;
                    _log("waiting for the game to build its bodies before serving " + string.Join(", ", _waitingForBodies));
                }
                return;
            }
            foreach (var body in _waitingForBodies)
            {
                Start(body, ready);
            }
            _waitingForBodies.Clear();
            _toldWaiting = false;
        }

        private void Start(string body, List<BodyTextureResult> ready)
        {
            BodyTextureDescription? texture;
            string reason;
            try
            {
                texture = _source.Describe(body, out reason);
            }
            catch (Exception ex)
            {
                texture = null;
                reason = "its texture could not be looked up (" + ex.GetType().Name + ": " + ex.Message + ")";
            }
            if (texture == null || texture.Width <= 0 || texture.Height <= 0)
            {
                _log("no map for " + body + ": " + reason);
                ready.Add(new BodyTextureResult(body, null));
                return;
            }

            var (width, height) = OutputSize(texture.Width, texture.Height);
            var key = BodyTextureCache.Key(texture, width, height);
            var job = new Job(texture, width, height, key);
            job.Work = _run(() => _cache.TryRead(body, key));
            _probing.Add(job);
        }

        private void AdvanceRead(double now, double frameMs)
        {
            if (_reading == null)
            {
                if (_waitingForCard.Count == 0)
                {
                    return;
                }
                var next = _waitingForCard.Dequeue();
                try
                {
                    next.Read = _source.BeginRead(next.Texture, next.Width, next.Height);
                }
                catch (Exception ex)
                {
                    Fail(next, ex);
                    return;
                }
                CardReads++;
                GpuReadBudget.Record(1, now);
                next.Clock.Restart();
                _log("reading the map of " + next.Texture.Body + " from the graphics card: " + next.Texture.TextureName + ", "
                    + next.Texture.Width + " by " + next.Texture.Height + " " + next.Texture.Format + ", sent at " + next.Width + " by " + next.Height);
                _reading = next;
                /* The first strip is read on a later frame, after the card has had a frame to draw the scaled copy. */
                return;
            }

            var job = _reading;
            job.Frames++;
            job.WorstFrameMs = Math.Max(job.WorstFrameMs, frameMs);
            bool done;
            var strip = System.Diagnostics.Stopwatch.StartNew();
            try
            {
                done = job.Read!.Advance();
                job.LongestStripMs = Math.Max(job.LongestStripMs, strip.Elapsed.TotalMilliseconds);
            }
            catch (Exception ex)
            {
                _reading = null;
                job.Read?.Dispose();
                Fail(job, ex);
                return;
            }
            if (!done)
            {
                return;
            }

            _reading = null;
            _log("read the map of " + job.Texture.Body + " in " + job.Clock.ElapsedMilliseconds + " ms over " + job.Frames
                + " frames: worst frame " + Math.Round(job.WorstFrameMs) + " ms, longest strip " + Math.Round(job.LongestStripMs, 1) + " ms");
            var rgba = job.Read!.Rgba;
            job.Read.Dispose();
            job.Read = null;
            job.Work = _run(() => EncodeAndKeep(job, rgba));
            _encoding.Add(job);
        }

        private void Fail(Job job, Exception ex)
        {
            _log("the map of " + job.Texture.Body + " could not be read: " + ex.GetType().Name + ": " + ex.Message);
            _encoding.Add(new Job(job.Texture, job.Width, job.Height, job.Key) { Work = Task.FromResult<byte[]?>(null) });
        }

        /* WORKER-THREAD. A map that cannot be written to the cache is still sent; it is read from the card again next game. */
        private byte[]? EncodeAndKeep(Job job, byte[] rgba)
        {
            var readMs = job.Clock.ElapsedMilliseconds;
            var png = BodyTexturePng.EncodeFromGame(rgba, job.Width, job.Height);
            _log("the map of " + job.Texture.Body + " is " + png.Length + " bytes: read in " + readMs + " ms, encoded in " + (job.Clock.ElapsedMilliseconds - readMs) + " ms");
            try
            {
                _cache.Write(job.Texture.Body, job.Key, png);
            }
            catch (Exception ex)
            {
                _log("the map of " + job.Texture.Body + " could not be cached in " + _cache.Directory + ": " + ex.Message);
            }
            return png;
        }

        private sealed class Job
        {
            public Job(BodyTextureDescription texture, int width, int height, string key)
            {
                Texture = texture;
                Width = width;
                Height = height;
                Key = key;
            }

            public BodyTextureDescription Texture { get; }

            public int Width { get; }

            public int Height { get; }

            public string Key { get; }

            public Task<byte[]?>? Work { get; set; }

            public IBodyTextureRead? Read { get; set; }

            /// <summary>Frames the read has taken a strip on.</summary>
            public int Frames { get; set; }

            /// <summary>The longest gap between two of those frames.</summary>
            public double WorstFrameMs { get; set; }

            /// <summary>The longest one strip's read took within its frame.</summary>
            public double LongestStripMs { get; set; }

            /// <summary>Running from the start of the card read.</summary>
            public System.Diagnostics.Stopwatch Clock { get; } = new System.Diagnostics.Stopwatch();
        }
    }
}
