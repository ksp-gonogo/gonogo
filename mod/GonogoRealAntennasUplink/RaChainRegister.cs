using System.Collections.Generic;

namespace Gonogo.RealAntennasUplink
{
    /// <summary>
    /// Every fallback chain the craft is holding, keyed by the antenna address
    /// the targeting commands already use. KSP-free and RealAntennas-free, so its
    /// whole surface is reachable headlessly.
    ///
    /// <para><b>It is operator INTENT and therefore outlives everything.</b> A
    /// chain has to survive the thing it exists for (a lost link), the thing the
    /// operator does next (a scene change), and the thing they do at the end of a
    /// session (a save and a reload). So this is a process-lifetime register that
    /// a scenario module puts in the save, rather than state hanging off a
    /// vessel or a scene.</para>
    ///
    /// <para><b>Keyed by antenna, not by craft.</b> That is the granularity
    /// RealAntennas stores a target at, and the address is already stable across
    /// a reordering of a craft's antenna list, which is what makes it usable as a
    /// save key. An antenna whose part cannot be read falls back to a positional
    /// address, and a chain keyed on one of those is not carried across a
    /// reload.</para>
    /// </summary>
    internal sealed class RaChainRegister
    {
        /// <summary>One antenna's chain, and where its walk has got to.</summary>
        internal sealed class Entry
        {
            public List<RealAntennasTargetStepArgs> Steps = new List<RealAntennasTargetStepArgs>();

            /// <summary>The settle time as the operator asked for it, null for the default.</summary>
            public double? RequestedSettleSeconds;

            public RaChainPolicy.Walk Walk = new RaChainPolicy.Walk();

            /// <summary>The settle time actually in force, which is what the read-back reports.</summary>
            public double SettleSeconds => RaChainPolicy.SettleSecondsFor(RequestedSettleSeconds);
        }

        private readonly Dictionary<string, Entry> _chains = new Dictionary<string, Entry>();

        /// <summary>Every antenna currently holding a chain, in no particular order.</summary>
        public IEnumerable<KeyValuePair<string, Entry>> Entries => _chains;

        public int Count => _chains.Count;

        public Entry? Find(string? antennaId) =>
            antennaId != null && _chains.TryGetValue(antennaId, out var entry) ? entry : null;

        /// <summary>
        /// Replaces the antenna's chain. An empty list CLEARS it, which is the
        /// only way a walk stops.
        ///
        /// <para>The walk is rewound rather than carried over, because an index
        /// into the old list says nothing about the new one, and the first entry
        /// of a freshly sent chain is the one the operator means to be tried
        /// first.</para>
        /// </summary>
        public void Set(string antennaId, IReadOnlyList<RealAntennasTargetStepArgs> steps, double? requestedSettleSeconds)
        {
            if (steps == null || steps.Count == 0)
            {
                _chains.Remove(antennaId);
                return;
            }

            var entry = new Entry
            {
                Steps = new List<RealAntennasTargetStepArgs>(steps),
                RequestedSettleSeconds = requestedSettleSeconds,
            };
            RaChainPolicy.Rewind(entry.Walk);
            _chains[antennaId] = entry;
        }

        /// <summary>
        /// Restores one chain as the save held it, walk position included. Unlike
        /// <see cref="Set"/> this does NOT rewind: a reload mid-outage must not
        /// send the craft back to a target it has already tried and, worse, off
        /// the one that is currently working.
        /// </summary>
        public void Restore(
            string antennaId,
            IReadOnlyList<RealAntennasTargetStepArgs> steps,
            double? requestedSettleSeconds,
            int? activeStep,
            double? lastAppliedUt,
            int laps)
        {
            if (string.IsNullOrEmpty(antennaId) || steps == null || steps.Count == 0)
            {
                return;
            }

            _chains[antennaId] = new Entry
            {
                Steps = new List<RealAntennasTargetStepArgs>(steps),
                RequestedSettleSeconds = requestedSettleSeconds,
                Walk = new RaChainPolicy.Walk
                {
                    // An index the restored list cannot hold is dropped rather
                    // than clamped: it means the chain was edited between the save
                    // and the load, and clamping would aim at whatever happened to
                    // be last.
                    ActiveStep = activeStep != null && activeStep.Value >= 0 && activeStep.Value < steps.Count
                        ? activeStep
                        : null,
                    LastAppliedUt = lastAppliedUt,
                    Laps = laps < 0 ? 0 : laps,
                },
            };
        }

        /// <summary>Empties the register, for a scenario module taking in a different save.</summary>
        public void Clear() => _chains.Clear();
    }
}
