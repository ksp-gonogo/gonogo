using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace Gonogo.KSP
{
    /// <summary>
    /// The newest <c>[Gonogo]</c> lines the game logged, held in a bounded ring
    /// with anything that identifies a player or a machine already removed.
    /// Answers <c>system.log.recent</c>, so a bug report can carry the mod's own
    /// lines without the player finding <c>KSP.log</c>.
    /// </summary>
    public sealed class LogTail
    {
        private const string Prefix = "[Gonogo]";

        private static readonly Regex WindowsPath = new Regex(@"[A-Za-z]:\\[^\s""'<>|]+", RegexOptions.Compiled);
        private static readonly Regex UnixPath = new Regex(@"(?:~|\.\.?)?/(?:[\w.@+-]+/)+[\w.@+-]*", RegexOptions.Compiled);
        private static readonly Regex Ipv4 = new Regex(@"\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b", RegexOptions.Compiled);
        private static readonly Regex Ipv6 = new Regex(@"\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
        private static readonly Regex Uuid = new Regex(@"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
        private static readonly Regex PeerId = new Regex(@"\bstation-[\w-]+", RegexOptions.Compiled);
        private static readonly Regex ShareCode = new Regex(@"\b((?i:host|code|share|room|peer|station))(\W{0,3})\s*[A-Z0-9]{4}\b", RegexOptions.Compiled);

        private readonly string[] _ring;
        private readonly object _gate = new object();
        private int _next;
        private int _count;

        public LogTail(int capacity)
        {
            if (capacity < 1) throw new ArgumentOutOfRangeException(nameof(capacity));
            _ring = new string[capacity];
        }

        /// <summary>The tail the running mod fills from the game's log.</summary>
        public static LogTail Shared { get; } = new LogTail(400);

        /// <summary>Keeps <paramref name="message"/> when it is one of the mod's lines, redacted; ignores any other.</summary>
        public void Add(string? message)
        {
            if (message == null || !message.StartsWith(Prefix, StringComparison.Ordinal)) return;
            var line = Redact(message.TrimEnd());
            lock (_gate)
            {
                _ring[_next] = line;
                _next = (_next + 1) % _ring.Length;
                if (_count < _ring.Length) _count++;
            }
        }

        /// <summary>The newest <paramref name="max"/> lines, oldest first.</summary>
        public List<string> Recent(int max)
        {
            lock (_gate)
            {
                var take = Math.Min(Math.Max(max, 0), _count);
                var lines = new List<string>(take);
                for (var i = _count - take; i < _count; i++)
                {
                    lines.Add(_ring[(_next - _count + i + _ring.Length * 2) % _ring.Length]);
                }
                return lines;
            }
        }

        /// <summary>The line with file paths, IP addresses, peer ids and share codes replaced.</summary>
        public static string Redact(string line)
        {
            var s = WindowsPath.Replace(line, "<path>");
            s = UnixPath.Replace(s, "<path>");
            s = Ipv4.Replace(s, "<ip>");
            s = Ipv6.Replace(s, "<ip>");
            s = Uuid.Replace(s, "<id>");
            s = PeerId.Replace(s, "<peer>");
            return ShareCode.Replace(s, m => m.Groups[1].Value + " <code>");
        }
    }
}
