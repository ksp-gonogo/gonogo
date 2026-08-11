using System.Collections.Generic;
using Sitrep.Contract;

namespace Gonogo.KerbalismUplink
{
    /// <summary>
    /// Kerbalism's <see cref="IIsruBackend"/>: the provider that WINS the "isru"
    /// election when Kerbalism is installed. It has to win outright rather than
    /// augment, because Kerbalism's own patches delete
    /// <c>ModuleResourceHarvester</c> and <c>ModuleResourceConverter</c> outright, so
    /// on a Kerbalism install the stock reader walks a vessel and reports nothing at
    /// all.
    ///
    /// <para>Reads the active vessel internally (FlightGlobals) like every other
    /// backend in this Uplink, so the interface stays KSP-free; the reflection lives
    /// in <see cref="KerbalismReflection"/> and the mapping in
    /// <see cref="KerbalismIsruMap"/>.</para>
    ///
    /// <para><b>No capture bundle, unlike the science backend.</b> A science channel
    /// mapper runs on the Courier thread, so that backend needs its PartModule reads
    /// stashed from a main-thread capture. ISRU does not: <c>IsruCoreUplink</c> calls
    /// <see cref="Drills"/>/<see cref="Converters"/> from its own main-thread capture,
    /// so these read live and the factory can simply construct.</para>
    ///
    /// <para>The profile is read once and cached: its process definitions are static
    /// after load, and the recipe join needs them on every pass.</para>
    /// </summary>
    public sealed class KerbalismIsruBackend : IIsruBackend
    {
        private readonly KerbalismReflection _k;
        private ProfileRaw? _profile;

        public KerbalismIsruBackend(KerbalismReflection k) => _k = k;

        public string BackendId => KerbalismIsruMap.ProviderId;

        public IReadOnlyList<IsruDrillEntry> Drills()
        {
            var v = FlightGlobals.ActiveVessel;
            if (v == null)
            {
                return new List<IsruDrillEntry>();
            }

            var entries = KerbalismIsruMap.Drills(_k.Harvesters(v));
            ApplyPartTitles(v, entries, e => e.PartId, (e, title) => e.PartTitle = title);
            return entries;
        }

        public IReadOnlyList<IsruConverterEntry> Converters()
        {
            var v = FlightGlobals.ActiveVessel;
            if (v == null)
            {
                return new List<IsruConverterEntry>();
            }

            var profile = _profile ??= _k.Profile();
            var processes = new List<ProcessRaw>(_k.Processes(v));
            // The same live modifier product the life-support capture applies, shared
            // rather than reimplemented so one part cannot report two different rates
            // depending on which channel asked.
            KerbalismUplink.ApplyProcessEnvModifiers(_k, processes, profile, v, _k.BeginModifierContext(v));

            var entries = KerbalismIsruMap.Converters(processes, profile.Processes);
            ApplyPartTitles(v, entries, e => e.PartId, (e, title) => e.PartTitle = title);
            return entries;
        }

        /// <summary>
        /// Fills each entry's part title from the live vessel. The mappers leave it
        /// null because neither Kerbalism module carries a part title of its own, and
        /// the alternative to this join would be the mapper inventing one from the
        /// process title, which is a different thing: one part can be reconfigured to
        /// run a different process.
        /// </summary>
        private static void ApplyPartTitles<T>(
            Vessel vessel,
            List<T> entries,
            System.Func<T, string?> partId,
            System.Action<T, string?> setTitle)
        {
            if (entries.Count == 0 || vessel.parts == null)
            {
                return;
            }

            var titles = new Dictionary<string, string?>();
            for (var i = 0; i < vessel.parts.Count; i++)
            {
                var part = vessel.parts[i];
                if (part == null || part.flightID == 0)
                {
                    continue;
                }

                titles[part.flightID.ToString()] = part.partInfo != null ? part.partInfo.title : part.name;
            }

            foreach (var entry in entries)
            {
                var id = partId(entry);
                if (id != null && titles.TryGetValue(id, out var title))
                {
                    setTitle(entry, title);
                }
            }
        }
    }
}
