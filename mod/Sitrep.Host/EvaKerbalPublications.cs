using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// What to put on each kerbal's own <c>eva.kerbal.&lt;vessel id&gt;.state</c> Topic this
    /// tick: the suit state of every kerbal outside, and one withdrawal for each kerbal
    /// that was outside last tick and is not now.
    ///
    /// <para>Not a change-gate: the emitter already puts nothing on the wire for a value
    /// equal to the last one published. Courier-thread-only, so the set of kerbals seen
    /// last tick needs no lock.</para>
    /// </summary>
    public sealed class EvaKerbalPublications
    {
        private readonly HashSet<string> _outside = new HashSet<string>(System.StringComparer.Ordinal);

        /// <summary>One value for a sub-topic of the kerbal namespace; a null <see cref="Payload"/> withdraws it.</summary>
        public readonly struct Publication
        {
            public Publication(string subTopic, object? payload)
            {
                SubTopic = subTopic;
                Payload = payload;
            }

            /// <summary>The part of the Topic after <see cref="VesselViewProvider.EvaKerbalPrefix"/>.</summary>
            public string SubTopic { get; }

            public object? Payload { get; }
        }

        /// <summary>
        /// The publications for this tick's snapshot. A snapshot that carries no roster
        /// publishes nothing and withdraws nothing, because it says nothing about who is
        /// outside.
        /// </summary>
        public List<Publication> Next(KspSnapshot? snapshot)
        {
            var kerbals = VesselViewProvider.BuildEvaKerbals(snapshot);
            var publications = new List<Publication>();
            if (kerbals == null)
            {
                return publications;
            }

            var now = new HashSet<string>(System.StringComparer.Ordinal);
            foreach (var kerbal in kerbals)
            {
                var id = kerbal.KerbalVesselId!;
                now.Add(id);
                publications.Add(new Publication(SubTopicOf(id), VesselViewProvider.BuildEvaKerbalWire(kerbal)));
            }

            foreach (var gone in _outside.Where(id => !now.Contains(id)).OrderBy(id => id, System.StringComparer.Ordinal))
            {
                publications.Add(new Publication(SubTopicOf(gone), null));
            }

            _outside.Clear();
            _outside.UnionWith(now);
            return publications;
        }

        private static string SubTopicOf(string kerbalVesselId) =>
            kerbalVesselId + "." + VesselViewProvider.EvaKerbalField;
    }
}
