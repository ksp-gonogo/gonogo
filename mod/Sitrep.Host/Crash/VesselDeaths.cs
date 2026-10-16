using System;
using System.Collections.Generic;

namespace Sitrep.Host.Crash
{
    /// <summary>
    /// Pairs stock's per-part impact events with the vessel deaths they cause, so a broken
    /// leg on a craft that flies on is never published as the craft's death, and a death
    /// by impact is still named as one.
    ///
    /// <para>Stock raises <c>onCrash</c> and <c>onCrashSplashdown</c> once for every part
    /// that breaks, on a craft that may well survive. A craft dies only when its root part
    /// does, which raises <c>onVesselWillDestroy</c>. The two arrive in either order:
    /// <c>onCrashSplashdown</c> fires before the part is killed, while <c>onCrash</c> fires
    /// after <c>Part.explode</c> has already run <c>Vessel.Die</c> on the same call stack.
    /// So an impact is noted (<see cref="Impact"/>), a death is held
    /// (<see cref="Death"/>) and takes the most recent impact as its cause, an impact
    /// arriving while its death is held amends it, and the held deaths are published from
    /// the next main-thread tick (<see cref="Drain"/>).</para>
    ///
    /// <para>Not thread-safe: every entry point runs on the KSP main thread.</para>
    /// </summary>
    /// <typeparam name="TRecord">What the producer captured from the vessel as it died.</typeparam>
    /// <typeparam name="TImpact">What an impact event says about the part that broke.</typeparam>
    public sealed class VesselDeaths<TRecord, TImpact>
        where TImpact : class
    {
        private readonly double _windowUt;
        private readonly Dictionary<string, Noted> _impacts = new Dictionary<string, Noted>();
        private readonly Dictionary<string, double> _publishedUt = new Dictionary<string, double>();
        private readonly List<string> _heldOrder = new List<string>();
        private readonly Dictionary<string, Held> _held = new Dictionary<string, Held>();
        private double? _lastDrainUt;

        /// <param name="windowUt">How far apart, in UT seconds, an impact and a death can be
        /// and still be one event, and how long after a published death a second death of
        /// the same vessel id is taken as the same one.</param>
        public VesselDeaths(double windowUt)
        {
            _windowUt = windowUt;
        }

        /// <summary>A part of the vessel broke on impact. Amends the vessel's held death
        /// when there is one, and is otherwise kept for a death that follows.</summary>
        public void Impact(string vesselId, TImpact impact, double ut)
        {
            if (_held.TryGetValue(vesselId, out var held))
            {
                held.Impact ??= impact;
                return;
            }
            _impacts[vesselId] = new Noted(impact, ut);
        }

        /// <summary>The vessel died. Held for <see cref="Drain"/>; a second death of the
        /// same vessel while one is held, or within the window of the last one published,
        /// is the same death and is dropped. Returns true when this death was kept and false
        /// when it was dropped as a repeat.</summary>
        public bool Death(string vesselId, TRecord record, double ut)
        {
            if (_held.ContainsKey(vesselId))
            {
                return false;
            }
            if (_publishedUt.TryGetValue(vesselId, out var published) && Math.Abs(ut - published) <= _windowUt)
            {
                return false;
            }

            TImpact? cause = null;
            if (_impacts.TryGetValue(vesselId, out var noted))
            {
                _impacts.Remove(vesselId);
                if (Math.Abs(ut - noted.Ut) <= _windowUt)
                {
                    cause = noted.Impact;
                }
            }

            _held[vesselId] = new Held(record, ut) { Impact = cause };
            _heldOrder.Add(vesselId);
            return true;
        }

        /// <summary>The vessel's flight ended some other way, such as a recovery, which the
        /// producer publishes at once. Returns false when a death of the vessel is held or
        /// was published within the window, so the one ending is not published twice; a
        /// death that follows within the window is then dropped.</summary>
        public bool TryEnd(string vesselId, double ut)
        {
            if (_held.ContainsKey(vesselId))
            {
                return false;
            }
            if (_publishedUt.TryGetValue(vesselId, out var published) && Math.Abs(ut - published) <= _windowUt)
            {
                return false;
            }
            _publishedUt[vesselId] = ut;
            return true;
        }

        /// <summary>Every held death in the order it happened, each with the impact that
        /// caused it or null when none did. Impacts too old to belong to any death are
        /// forgotten here, and a clock gone back (a quickload or a revert) forgets every
        /// published death and noted impact, since they happened in the abandoned
        /// future and the same death can happen again.</summary>
        public List<VesselDeath<TRecord, TImpact>> Drain(double nowUt)
        {
            if (_lastDrainUt.HasValue && nowUt < _lastDrainUt.Value)
            {
                _publishedUt.Clear();
                _impacts.Clear();
            }
            _lastDrainUt = nowUt;

            var deaths = new List<VesselDeath<TRecord, TImpact>>(_heldOrder.Count);
            foreach (var id in _heldOrder)
            {
                var held = _held[id];
                deaths.Add(new VesselDeath<TRecord, TImpact>(id, held.Record, held.Impact, held.Ut));
                _publishedUt[id] = held.Ut;
            }
            _heldOrder.Clear();
            _held.Clear();

            Prune(_impacts, nowUt, noted => noted.Ut);
            Prune(_publishedUt, nowUt, ut => ut);
            return deaths;
        }

        private void Prune<T>(Dictionary<string, T> byId, double nowUt, Func<T, double> utOf)
        {
            List<string>? stale = null;
            foreach (var entry in byId)
            {
                if (Math.Abs(nowUt - utOf(entry.Value)) > _windowUt)
                {
                    (stale ??= new List<string>()).Add(entry.Key);
                }
            }
            if (stale == null)
            {
                return;
            }
            foreach (var id in stale)
            {
                byId.Remove(id);
            }
        }

        private readonly struct Noted
        {
            public Noted(TImpact impact, double ut)
            {
                Impact = impact;
                Ut = ut;
            }

            public TImpact Impact { get; }
            public double Ut { get; }
        }

        private sealed class Held
        {
            public Held(TRecord record, double ut)
            {
                Record = record;
                Ut = ut;
            }

            public TRecord Record { get; }
            public double Ut { get; }
            public TImpact? Impact { get; set; }
        }
    }

    /// <summary>One vessel death drained from <see cref="VesselDeaths{TRecord, TImpact}"/>.</summary>
    public readonly struct VesselDeath<TRecord, TImpact>
        where TImpact : class
    {
        public VesselDeath(string vesselId, TRecord record, TImpact? impact, double ut)
        {
            VesselId = vesselId;
            Record = record;
            Impact = impact;
            Ut = ut;
        }

        /// <summary>The vessel's id.</summary>
        public string VesselId { get; }

        /// <summary>What the producer captured as the vessel died.</summary>
        public TRecord Record { get; }

        /// <summary>The impact that caused the death, or null when it was not an impact.</summary>
        public TImpact? Impact { get; }

        /// <summary>The UT the vessel died at.</summary>
        public double Ut { get; }
    }
}
