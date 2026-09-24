using System;
using System.Collections.Generic;
using System.Globalization;
using Sitrep.Contract;

namespace Sitrep.Host.Alarms
{
    /// <summary>
    /// Which Topics a SCET threshold may be armed against, and how the
    /// simulation resolves one to a number.
    ///
    /// <para><b>An explicit table, and it has to be one.</b> The obvious
    /// alternative is to tap the values the channel loop already emits, which
    /// would give every Topic in the tree for free. It cannot be used: that loop
    /// skips any Topic nothing is currently subscribed to
    /// (<c>ChannelEngine.ProcessTick</c>), so a threshold on an unwatched Topic
    /// would silently never fire. That is the same subscription-starvation the
    /// alarm arm's capture is registered UNGATED to avoid, and routing the
    /// reading through a gated path would reintroduce it one layer down.</para>
    ///
    /// <para><b>Membership rule.</b> A Topic belongs here when its wire payload
    /// is a plain dictionary tree built by a pure function of the snapshot, and
    /// that payload is stamped with a <c>meta.source</c>, because the stamp is
    /// what lets an alarm armed against one craft refuse a reading about
    /// another. Every entry below is a <see cref="VesselViewProvider"/> wire
    /// adapter, which is also why nothing here needs the game: those adapters
    /// read the snapshot the host already built and touch no KSP API.</para>
    ///
    /// <para>List-shaped Topics are absent for a different reason from anything
    /// excluded on purpose: a dotted path cannot index a list, so a threshold on
    /// one could not address a value even if the Topic were here.</para>
    ///
    /// <para><b>An installed mod adds its own, through the Kernel.</b> The table
    /// below is core's and stays closed to everything outside this assembly; a
    /// mod contributes by registering an
    /// <see cref="IScetThresholdSources"/> provider against the
    /// <c>scetThresholdSources</c> capability, which is declared in
    /// <c>Sitrep.Contract</c> because that is the only assembly an Uplink may
    /// reference. Contributed entries are asked AFTER this table, so core's own
    /// reading of a core Topic cannot be displaced. They are builders handed over
    /// at registration and called on demand, never values scraped off the channel
    /// loop, so they keep the property the paragraph above is about.</para>
    /// </summary>
    public sealed class ScetThresholdSources
    {
        private static readonly Dictionary<string, Func<KspSnapshot?, object?>> Builders =
            new Dictionary<string, Func<KspSnapshot?, object?>>(StringComparer.Ordinal)
            {
                [VesselViewProvider.IdentityTopic] = VesselViewProvider.BuildIdentityWire,
                [VesselViewProvider.OrbitTopic] = VesselViewProvider.BuildOrbitWire,
                [VesselViewProvider.OrbitTruthTopic] = VesselViewProvider.BuildOrbitTruthWire,
                [VesselViewProvider.FlightTopic] = VesselViewProvider.BuildFlightWire,
                [VesselViewProvider.AttitudeTopic] = VesselViewProvider.BuildAttitudeWire,
                [VesselViewProvider.ResourcesTopic] = VesselViewProvider.BuildResourcesWire,
                [VesselViewProvider.ThermalTopic] = VesselViewProvider.BuildThermalWire,
                [VesselViewProvider.ControlTopic] = VesselViewProvider.BuildControlWire,
                [VesselViewProvider.PhysicsModeTopic] = VesselViewProvider.BuildPhysicsModeWire,
                [VesselViewProvider.CommsTopic] = VesselViewProvider.BuildCommsWire,
                [VesselViewProvider.PropulsionTopic] = VesselViewProvider.BuildPropulsionWire,
                [VesselViewProvider.ManeuverTopic] = VesselViewProvider.BuildManeuverWire,
                [VesselViewProvider.TargetTopic] = VesselViewProvider.BuildTargetWire,
                [VesselViewProvider.CrewTopic] = VesselViewProvider.BuildCrewWire,
                [VesselViewProvider.StructureTopic] = VesselViewProvider.BuildStructureWire,
                [VesselViewProvider.DockTopic] = VesselViewProvider.BuildDockWire,
                [VesselViewProvider.SurfaceTopic] = VesselViewProvider.BuildSurfaceWire,
                [VesselViewProvider.LandingTopic] = VesselViewProvider.BuildLandingWire,
                [VesselViewProvider.WarpTopic] = VesselViewProvider.BuildWarpWire,
                [VesselViewProvider.CalendarTopic] = VesselViewProvider.BuildCalendarWire,
                // The one entry that is not a VesselViewProvider adapter, and the
                // one whose subject is never a craft. Career bookkeeping belongs
                // to the save rather than to anything flying, so it is stamped
                // "game" and armed against that subject, the same way a clock is.
                // It is here because "funds reach X" is worth stopping a warp for:
                // an operator skipping months of build time wants the clock halted
                // when they can afford the next thing, and a client watching the
                // same number can only poll it a light-time late.
                [CareerViewProvider.Topic] = CareerViewProvider.BuildCareer,
            };

        /// <summary>
        /// The Kernel whose <c>scetThresholdSources</c> providers are asked
        /// after the table above, or null for core's own entries alone.
        /// </summary>
        private readonly Kernel? _kernel;

        /// <summary>
        /// Core's twenty-one entries and nothing else. What a caller with no
        /// Kernel in hand gets, and the right answer for a test that is about
        /// the built-in table rather than about the seam.
        /// </summary>
        public static ScetThresholdSources CoreOnly { get; } = new ScetThresholdSources(null);

        public ScetThresholdSources(Kernel? kernel) => _kernel = kernel;

        /// <summary>Every Topic a SCET threshold may address, in no particular order.</summary>
        public IEnumerable<string> Topics
        {
            get
            {
                foreach (var topic in Builders.Keys)
                {
                    yield return topic;
                }
                foreach (var source in Contributed())
                {
                    if (source.Build != null && !Builders.ContainsKey(source.Topic ?? ""))
                    {
                        yield return source.Topic!;
                    }
                }
            }
        }

        /// <summary>Whether a threshold armed against <paramref name="topic"/> could ever be read.</summary>
        public bool Knows(string? topic) =>
            !string.IsNullOrEmpty(topic) && TryGetBuilder(topic!, out _);

        /// <summary>
        /// The builder for <paramref name="topic"/>, core's own first.
        ///
        /// <para>The order is the precedence rule, not an optimisation: a
        /// contributed entry naming a Topic core already publishes is ignored, so
        /// an installed mod cannot change what a core reading means underneath an
        /// operator who armed against the number on their screen. It also keeps
        /// the common case free, because a threshold on a core Topic never asks
        /// the Kernel anything.</para>
        /// </summary>
        internal bool TryGetBuilder(string topic, out Func<KspSnapshot?, object?> builder)
        {
            if (Builders.TryGetValue(topic, out builder!))
            {
                return true;
            }
            foreach (var source in Contributed())
            {
                if (source.Build != null && string.Equals(source.Topic, topic, StringComparison.Ordinal))
                {
                    builder = source.Build;
                    return true;
                }
            }
            builder = null!;
            return false;
        }

        /// <summary>
        /// What the installed mods have contributed, or nothing at all.
        ///
        /// <para>Asked on demand rather than merged once, so there is no cached
        /// copy to go stale against a Kernel that resolves after this instance
        /// was built. A capability the Kernel does not know throws out of
        /// <c>Active</c>, and an install without the declaration is not one where
        /// SCET alarms should stop working, so that is swallowed; so is a
        /// provider that throws out of its own <c>Sources</c>, which costs that
        /// mod its Topics and nobody else theirs.</para>
        /// </summary>
        private IEnumerable<ScetThresholdSource> Contributed()
        {
            var kernel = _kernel;
            if (kernel == null)
            {
                yield break;
            }

            IReadOnlyList<object?> instances;
            try
            {
                instances = kernel.Active(ScetThresholdCapability.Id);
            }
            catch (Exception)
            {
                yield break;
            }

            foreach (var instance in instances)
            {
                if (instance is not IScetThresholdSources provider)
                {
                    continue;
                }

                IReadOnlyList<ScetThresholdSource>? sources;
                try
                {
                    sources = provider.Sources();
                }
                catch (Exception)
                {
                    continue;
                }

                if (sources == null)
                {
                    continue;
                }
                foreach (var source in sources)
                {
                    if (source != null && !string.IsNullOrEmpty(source.Topic))
                    {
                        yield return source;
                    }
                }
            }
        }
    }

    /// <summary>
    /// Reads a threshold's value out of ONE tick's snapshot.
    ///
    /// <para>Short-lived on purpose: one of these is built per capture and
    /// thrown away, because the payloads it caches are answers about an instant
    /// and reusing them across ticks would be the stale reading a SCET alarm
    /// exists to avoid. The cache is within the tick only, so two alarms on the
    /// same Topic cost one build.</para>
    ///
    /// <para>Nothing here touches KSP. The snapshot is already primitives, and
    /// the wire adapters that shape it are pure functions of it, which is what
    /// keeps the whole threshold arm exercisable without a game.</para>
    /// </summary>
    public sealed class SnapshotScetStateReader : IScetStateReader
    {
        private const string VesselSubjectPrefix = "vessel:";

        private readonly KspSnapshot? _snapshot;
        private readonly ScetThresholdSources _sources;
        private readonly Dictionary<string, object?> _payloads =
            new Dictionary<string, object?>(StringComparer.Ordinal);

        /// <summary>
        /// <paramref name="sources"/> is required rather than defaulted to
        /// <see cref="ScetThresholdSources.CoreOnly"/> on purpose. A default
        /// there reads as harmless and silently drops every Topic an installed
        /// mod contributed, which does not fail anything: it produces alarms that
        /// sit armed and never come due, and that is indistinguishable from a
        /// condition that has not been met.
        /// </summary>
        public SnapshotScetStateReader(KspSnapshot? snapshot, ScetThresholdSources sources)
        {
            _snapshot = snapshot;
            _sources = sources ?? ScetThresholdSources.CoreOnly;
        }

        public IDictionary<string, object?>? ReadPayload(string subject, string topic) =>
            Payload(topic) is { } root
                && ScetPayload.ReadSource(root) is { } source
                && string.Equals(source, subject, StringComparison.Ordinal)
                    ? root
                    : null;

        /// <summary>This tick's payload for <paramref name="topic"/>, built once and shared by every alarm that reads it.</summary>
        private IDictionary<string, object?>? Payload(string topic)
        {
            if (_snapshot == null
                || string.IsNullOrEmpty(topic)
                || !_sources.TryGetBuilder(topic, out var builder))
            {
                return null;
            }
            if (!_payloads.TryGetValue(topic, out var payload))
            {
                payload = builder(_snapshot);
                _payloads[topic] = payload;
            }
            return payload as IDictionary<string, object?>;
        }

        public ScetReading Read(string subject, string topic, string fieldPath)
        {
            if (string.IsNullOrEmpty(fieldPath) || Payload(topic) is not { } root)
            {
                return ScetReading.NotObservable;
            }

            // The payload's own provenance stamp: see ScetPayload.ReadSource.
            if (ScetPayload.ReadSource(root) is not { } source)
            {
                return ScetReading.NotObservable;
            }

            if (!string.Equals(source, subject, StringComparison.Ordinal))
            {
                return IsSubjectGone(subject) ? ScetReading.SubjectGone : ScetReading.NotObservable;
            }

            return ScetPayload.ReadNumber(root, fieldPath) is { } value
                ? ScetReading.Observed(value)
                : ScetReading.NotObservable;
        }

        /// <summary>
        /// Whether the craft this alarm names has left the simulation entirely,
        /// as opposed to merely not being the one the player is flying.
        ///
        /// <para>Answered off the full known-vessel roster the host samples every
        /// tick. An ABSENT roster answers no: the difference between "destroyed"
        /// and "the scene has not loaded yet" is exactly what would be guessed
        /// at, and calling an alarm dead because the main menu is up is the one
        /// wrong answer that cannot be taken back.</para>
        /// </summary>
        private bool IsSubjectGone(string subject)
        {
            if (!subject.StartsWith(VesselSubjectPrefix, StringComparison.Ordinal))
            {
                return false;
            }
            if (_snapshot?.Values == null
                || !_snapshot.Values.TryGetValue("vessels", out var raw)
                || raw is not IEnumerable<object?> roster)
            {
                return false;
            }

            var id = subject.Substring(VesselSubjectPrefix.Length);
            foreach (var entry in roster)
            {
                if (entry is IDictionary<string, object?> row
                    && row.TryGetValue("id", out var rowId)
                    && rowId is string text
                    && string.Equals(text, id, StringComparison.Ordinal))
                {
                    return false;
                }
            }
            return true;
        }
    }
}
