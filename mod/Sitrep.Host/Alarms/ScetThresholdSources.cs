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
    /// </summary>
    public static class ScetThresholdSources
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
            };

        /// <summary>Every Topic a SCET threshold may address, in no particular order.</summary>
        public static IEnumerable<string> Topics => Builders.Keys;

        /// <summary>Whether a threshold armed against <paramref name="topic"/> could ever be read.</summary>
        public static bool Knows(string? topic) =>
            !string.IsNullOrEmpty(topic) && Builders.ContainsKey(topic!);

        internal static bool TryGetBuilder(string topic, out Func<KspSnapshot?, object?> builder) =>
            Builders.TryGetValue(topic, out builder!);
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
        private readonly Dictionary<string, object?> _payloads =
            new Dictionary<string, object?>(StringComparer.Ordinal);

        public SnapshotScetStateReader(KspSnapshot? snapshot) => _snapshot = snapshot;

        public ScetReading Read(string subject, string topic, string fieldPath)
        {
            if (_snapshot == null
                || string.IsNullOrEmpty(topic)
                || string.IsNullOrEmpty(fieldPath)
                || !ScetThresholdSources.TryGetBuilder(topic, out var builder))
            {
                return ScetReading.NotObservable;
            }

            if (!_payloads.TryGetValue(topic, out var payload))
            {
                payload = builder(_snapshot);
                _payloads[topic] = payload;
            }

            if (payload is not IDictionary<string, object?> root)
            {
                return ScetReading.NotObservable;
            }

            // The payload's own provenance stamp, which is the ONLY thing that
            // stops an alarm armed against one craft answering off another's
            // readings after the player switches vessels. A payload that does
            // not say who it is about is not an answer to a question that names
            // a craft.
            if (ReadSource(root) is not { } source)
            {
                return ScetReading.NotObservable;
            }

            if (!string.Equals(source, subject, StringComparison.Ordinal))
            {
                return IsSubjectGone(subject) ? ScetReading.SubjectGone : ScetReading.NotObservable;
            }

            return ReadNumber(root, fieldPath) is { } value
                ? ScetReading.Observed(value)
                : ScetReading.NotObservable;
        }

        private static string? ReadSource(IDictionary<string, object?> root) =>
            root.TryGetValue("meta", out var raw)
                && raw is IDictionary<string, object?> meta
                && meta.TryGetValue("source", out var source)
                    ? source as string
                    : null;

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

        /// <summary>
        /// Walk a dotted path to a finite number, or null for anything else.
        ///
        /// <para>A bool or a string at the end of the path is a miss rather than
        /// a coercion. A threshold is a comparison between two numbers, and
        /// turning <c>true</c> into 1 would let an operator arm "landed &gt; 0.5"
        /// and get an alarm whose meaning nothing on screen explains.</para>
        /// </summary>
        private static double? ReadNumber(IDictionary<string, object?> root, string fieldPath)
        {
            object? current = root;
            var from = 0;
            while (from <= fieldPath.Length)
            {
                var dot = fieldPath.IndexOf('.', from);
                var segment = dot < 0
                    ? fieldPath.Substring(from)
                    : fieldPath.Substring(from, dot - from);
                if (segment.Length == 0
                    || current is not IDictionary<string, object?> node
                    || !node.TryGetValue(segment, out current))
                {
                    return null;
                }
                if (dot < 0)
                {
                    break;
                }
                from = dot + 1;
            }

            return AsFiniteNumber(current);
        }

        private static double? AsFiniteNumber(object? value)
        {
            double number;
            switch (value)
            {
                case double d: number = d; break;
                case float f: number = f; break;
                case int i: number = i; break;
                case long l: number = l; break;
                case short s: number = s; break;
                case byte b: number = b; break;
                case decimal m: number = (double)m; break;
                // An enum reaches the wire as its integer, and a threshold on one
                // is a legitimate way to ask "has the situation changed".
                case Enum e: number = Convert.ToDouble(e, CultureInfo.InvariantCulture); break;
                default: return null;
            }
            return double.IsNaN(number) || double.IsInfinity(number) ? null : number;
        }
    }
}
