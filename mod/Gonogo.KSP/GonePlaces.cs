using System;
using System.Collections.Generic;
using Sitrep.Host.Comms;

namespace Gonogo.KSP
{
    /// <summary>
    /// Where each object that has left the game would be now had it gone on as
    /// it was, for <see cref="CraftSighting.GoneSightHorizonSeconds"/> after it
    /// left. Each pass names the objects sight can place and how to place each;
    /// an object named on one pass and missing from the next has gone, and is
    /// placed by its last rule from then on. One named again is no longer gone.
    /// </summary>
    internal sealed class GonePlaces
    {
        private Dictionary<string, Func<double, Vector3d?>> _present =
            new Dictionary<string, Func<double, Vector3d?>>(StringComparer.Ordinal);

        private readonly Dictionary<string, (Func<double, Vector3d?> Where, double GoneUt)> _gone =
            new Dictionary<string, (Func<double, Vector3d?>, double)>(StringComparer.Ordinal);

        /// <param name="present">Every object sight can place this pass, by node id, with how to place it at a given UT.</param>
        /// <param name="ut">The pass's UT.</param>
        internal void Note(IReadOnlyDictionary<string, Func<double, Vector3d?>> present, double ut)
        {
            foreach (var kv in _present)
            {
                if (!present.ContainsKey(kv.Key) && !_gone.ContainsKey(kv.Key))
                {
                    _gone[kv.Key] = (kv.Value, ut);
                }
            }
            foreach (var key in new List<string>(_gone.Keys))
            {
                if (present.ContainsKey(key) || ut - _gone[key].GoneUt > CraftSighting.GoneSightHorizonSeconds || ut < _gone[key].GoneUt)
                {
                    _gone.Remove(key);
                }
            }
            _present = new Dictionary<string, Func<double, Vector3d?>>(StringComparer.Ordinal);
            foreach (var kv in present)
            {
                _present[kv.Key] = kv.Value;
            }
        }

        /// <summary>Each gone object placed at <paramref name="ut"/>; one its rule cannot place is left out.</summary>
        internal IEnumerable<(string Key, Vector3d At)> At(double ut)
        {
            foreach (var kv in _gone)
            {
                var at = kv.Value.Where(ut);
                if (at.HasValue)
                {
                    yield return (kv.Key, at.Value);
                }
            }
        }

        /// <summary>Forgets every object, as when the timeline is replaced.</summary>
        internal void Clear()
        {
            _present.Clear();
            _gone.Clear();
        }
    }
}
