using System;
using System.Collections.Generic;

namespace Gonogo.KSP
{
    /// <summary>
    /// The last universal time each craft was seen connected. Main thread only.
    ///
    /// <para>It belongs to one game and one timeline. Another game loaded drops all of it,
    /// a clock gone back drops every contact later than the clock, since that contact
    /// happened in the abandoned future, and a craft no longer in the world is
    /// forgotten.</para>
    /// </summary>
    internal sealed class LastContactBook
    {
        private readonly Dictionary<string, double> _byId = new Dictionary<string, double>(StringComparer.Ordinal);
        private string? _game;
        private double? _lastUt;

        /// <summary>Opens a pass over the fleet at <paramref name="ut"/> in <paramref name="game"/>.</summary>
        public void BeginPass(string? game, double ut)
        {
            var anotherGame = game != null && _game != null && !string.Equals(game, _game, StringComparison.Ordinal);
            var clockWentBack = _lastUt.HasValue && ut < _lastUt.Value;
            if (game != null)
            {
                _game = game;
            }
            _lastUt = ut;

            if (anotherGame)
            {
                _byId.Clear();
                return;
            }
            if (clockWentBack)
            {
                DropLaterThan(ut);
            }
        }

        /// <summary>Records one craft's link at <paramref name="ut"/>.</summary>
        public void Observe(string id, bool connected, double ut)
        {
            if (connected)
            {
                _byId[id] = ut;
            }
        }

        /// <summary>The last time the craft was seen connected, or null when it has not been.</summary>
        public double? Of(string id) => _byId.TryGetValue(id, out var ut) ? ut : (double?)null;

        /// <summary>Forgets every craft not in <paramref name="live"/>.</summary>
        public void Keep(ICollection<string> live)
        {
            List<string>? gone = null;
            foreach (var id in _byId.Keys)
            {
                if (!live.Contains(id))
                {
                    (gone ??= new List<string>()).Add(id);
                }
            }
            if (gone == null)
            {
                return;
            }
            foreach (var id in gone)
            {
                _byId.Remove(id);
            }
        }

        /// <summary>How many craft are held. For tests.</summary>
        public int Count => _byId.Count;

        private void DropLaterThan(double ut)
        {
            List<string>? later = null;
            foreach (var entry in _byId)
            {
                if (entry.Value > ut)
                {
                    (later ??= new List<string>()).Add(entry.Key);
                }
            }
            if (later == null)
            {
                return;
            }
            foreach (var id in later)
            {
                _byId.Remove(id);
            }
        }
    }
}
