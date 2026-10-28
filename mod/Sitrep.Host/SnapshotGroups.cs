using System;
using System.Collections.Generic;

namespace Sitrep.Host
{
    /// <summary>What reads one snapshot group: Topics by name, and every Topic an Uplink of a listed id owns.</summary>
    public sealed class SnapshotGroupReaders
    {
        public SnapshotGroupReaders(IEnumerable<string> topics, IEnumerable<string> owners)
        {
            Topics = new HashSet<string>(topics, StringComparer.Ordinal);
            Owners = new HashSet<string>(owners, StringComparer.Ordinal);
        }

        public HashSet<string> Topics { get; }

        public HashSet<string> Owners { get; }
    }

    /// <summary>
    /// The snapshot groups a game sample may leave out when none of their readers is
    /// due, which only matters while some Topic runs faster than the base rate: those
    /// groups are then built on the base ticks alone. Each is costly and read by few.
    /// Every reader of each is listed here; a test fails on a reader it does not list.
    /// </summary>
    public static class SnapshotGroups
    {
        /// <summary>The career's contracts, strategies, tech and facilities, at the top level of the snapshot.</summary>
        public const string Career = "career";

        /// <summary>The Space Center's launch sites, crew, saved craft and parts, at the top level of the snapshot.</summary>
        public const string SpaceCenter = "spaceCenter";

        /// <summary>The active vessel's part tree, inside the snapshot's <c>vessel</c> group.</summary>
        public const string Topology = "topology";

        /// <summary>
        /// The readers of each group. The alarms read the career and the Space Center
        /// through these same Topics' builders, and treat a payload they cannot build as
        /// not observable, so a skipped group leaves an alarm armed and unchanged.
        /// </summary>
        public static readonly IReadOnlyDictionary<string, SnapshotGroupReaders> Readers =
            new Dictionary<string, SnapshotGroupReaders>(StringComparer.Ordinal)
            {
                [Career] = new SnapshotGroupReaders(
                    new[] { CareerViewProvider.Topic, CareerViewProvider.ModeTopic, CareerViewProvider.FacilitiesTopic },
                    new[] { "career" }),
                [SpaceCenter] = new SnapshotGroupReaders(
                    new[]
                    {
                        SpaceCenterViewProvider.LaunchSitesTopic,
                        SpaceCenterViewProvider.SceneTopic,
                        SpaceCenterViewProvider.CrewRosterTopic,
                        SpaceCenterViewProvider.SavedShipsTopic,
                        SpaceCenterViewProvider.PartsAvailableTopic,
                        SpaceCenterViewProvider.PoisTopic,
                        SpaceCenterViewProvider.AstronautComplexTopic,
                    },
                    new[] { "spaceCenter" }),
                [Topology] = new SnapshotGroupReaders(
                    new[] { VesselPartsViewProvider.PartsTopic, PartsViewProvider.PowerTopic },
                    Array.Empty<string>()),
            };
    }
}
