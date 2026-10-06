using System;
using System.Collections.Generic;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// How long a command centre believed each craft's word would take to reach
    /// it, by when it believed so: at each look, the delay its own plan gave a
    /// word leaving the craft at that instant, relays and waits for a window
    /// included, or that it gave no route at all.
    ///
    /// <para>It answers one question. A centre that held a craft's link as up
    /// and has heard nothing new knows the craft unchanged as late as the last
    /// instant a word could have left it and already have arrived. That is not
    /// "now less the delay": a route that has lengthened since, by a relay
    /// moving or a change of relay, means words sent lately are still on their
    /// way, and silence says nothing of them yet.</para>
    ///
    /// <para>Asking for an instant forgets what was believed before the answer,
    /// so an earlier instant is not to be asked afterwards. Courier thread
    /// only.</para>
    /// </summary>
    public sealed class RouteDelayByWhen
    {
        /// <summary>The most looks kept for one craft; the oldest go first.</summary>
        public const int MostKept = 4096;

        private readonly Dictionary<string, List<(double SentUt, double? Seconds)>> _believed =
            new Dictionary<string, List<(double, double?)>>(StringComparer.Ordinal);

        /// <summary>Notes what the centre believed at <paramref name="ut"/>: that a word leaving the craft then takes <paramref name="seconds"/> to arrive, or null that it has no route.</summary>
        public void Note(string id, double ut, double? seconds)
        {
            if (!_believed.TryGetValue(id, out var looks))
            {
                looks = new List<(double, double?)>();
                _believed[id] = looks;
            }
            looks.Add((ut, seconds));
            if (looks.Count > MostKept)
            {
                looks.RemoveRange(0, looks.Count - MostKept);
            }
        }

        /// <summary>
        /// The latest instant by which the craft is known unchanged to a centre
        /// that, at <paramref name="knownAt"/>, held its link as up and had heard
        /// nothing new; or null where no word sent since it believed anything
        /// could have arrived yet.
        /// </summary>
        /// <param name="lastWordSeconds">How long the craft's last word was measured to take to reach the centre. The answer is never later than <paramref name="knownAt"/> less this: the plan can believe in a shorter route than the game carries word by.</param>
        /// <param name="floorSeconds">The delay to go by where the centre had believed nothing of the route by then.</param>
        public double? UnchangedTo(string id, double knownAt, double lastWordSeconds, double floorSeconds)
        {
            if (!_believed.TryGetValue(id, out var looks) || looks.Count == 0 || looks[0].SentUt > knownAt)
            {
                return knownAt - floorSeconds;
            }
            var arrived = -1;
            for (var i = 0; i < looks.Count && looks[i].SentUt <= knownAt; i++)
            {
                // A word that waits for a window arrives no sooner than one sent before it, so the latest look whose word is in speaks for all before it.
                if (looks[i].Seconds != null && looks[i].SentUt + looks[i].Seconds!.Value <= knownAt)
                {
                    arrived = i;
                }
            }
            if (arrived < 0)
            {
                return null;
            }
            var sent = looks[arrived].SentUt;
            if (arrived > 0)
            {
                looks.RemoveRange(0, arrived);
            }
            return Math.Min(sent, knownAt - lastWordSeconds);
        }

        public void Clear() => _believed.Clear();
    }
}
