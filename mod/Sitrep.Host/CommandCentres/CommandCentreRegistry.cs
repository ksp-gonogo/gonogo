using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.CommandCentres
{
    /// <summary>
    /// Holds the registered command-centre sources and enumerates the currently
    /// active centres each pass. Sources are re-enumerated live on every
    /// <see cref="EnumerateActive"/> call (a dynamic source such as a crewed
    /// control vessel appears/disappears/moves between passes). "The set of
    /// authorities" is literally the flattened, active, id-deduped enumeration.
    ///
    /// <para>A duplicate id is never dropped quietly. Every centre after the first
    /// to claim an id is missing from everything built on this enumeration, so
    /// each pass records the collisions it saw in <see cref="Collisions"/> and the
    /// first sighting of each colliding id goes to the report sink. That silence is
    /// how every ground station of a mod that flags them all as KSC came to mint
    /// <c>"ksc"</c>, and all but one vanished, without a word.</para>
    ///
    /// <para>MAIN-THREAD-ONLY: <see cref="EnumerateActive"/> runs each source live, and the
    /// production sources read Unity and KSP state that may only be touched on the main
    /// thread. A reader on another thread takes a snapshot captured there instead.</para>
    /// </summary>
    public sealed class CommandCentreRegistry
    {
        private static readonly IReadOnlyList<CommandCentreIdCollision> NoCollisions = new CommandCentreIdCollision[0];

        private readonly List<ICommandCentreSource> _sources = new List<ICommandCentreSource>();
        private readonly Action<string>? _report;
        private readonly HashSet<string> _reportedIds = new HashSet<string>(StringComparer.Ordinal);
        private volatile IReadOnlyList<CommandCentreIdCollision> _collisions = NoCollisions;

        public CommandCentreRegistry()
            : this(null)
        {
        }

        /// <param name="report">
        /// Where a collision is announced, once per colliding id for the life of the
        /// registry. Null records collisions in <see cref="Collisions"/> without
        /// announcing them.
        /// </param>
        public CommandCentreRegistry(Action<string>? report) => _report = report;

        public void RegisterSource(ICommandCentreSource source) => _sources.Add(source);

        /// <summary>The id collisions the most recent <see cref="EnumerateActive"/> pass dropped a centre for.</summary>
        public IReadOnlyList<CommandCentreIdCollision> Collisions => _collisions;

        /// <summary>
        /// Flatten every source's live enumeration, keep only <see cref="ICommandCentre.IsActiveNow"/>
        /// centres, and dedupe by <see cref="ICommandCentre.Id"/> (first registered wins, and every
        /// later claimant is recorded as a <see cref="CommandCentreIdCollision"/>).
        /// </summary>
        public IReadOnlyList<ICommandCentre> EnumerateActive()
        {
            var keptBy = new Dictionary<string, string>(StringComparer.Ordinal);
            var result = new List<ICommandCentre>();
            List<CommandCentreIdCollision>? collisions = null;
            foreach (var source in _sources)
            {
                foreach (var centre in source.Enumerate())
                {
                    if (!centre.IsActiveNow())
                    {
                        continue;
                    }

                    if (keptBy.TryGetValue(centre.Id, out var keeper))
                    {
                        collisions ??= new List<CommandCentreIdCollision>();
                        collisions.Add(new CommandCentreIdCollision(centre.Id, keeper, source.ProviderId));
                        continue;
                    }

                    keptBy[centre.Id] = source.ProviderId;
                    result.Add(centre);
                }
            }

            _collisions = collisions ?? NoCollisions;
            if (collisions != null)
            {
                Report(collisions);
            }

            return result;
        }

        private void Report(List<CommandCentreIdCollision> collisions)
        {
            var sink = _report;
            if (sink == null)
            {
                return;
            }

            foreach (var collision in collisions)
            {
                lock (_reportedIds)
                {
                    if (!_reportedIds.Add(collision.Id))
                    {
                        continue;
                    }
                }

                try
                {
                    sink(
                        "command-centre id \"" + collision.Id + "\" is claimed more than once: kept the centre from \""
                        + collision.KeptProviderId + "\", dropped one from \"" + collision.DroppedProviderId
                        + "\". The dropped centre cannot be listed, selected as a vantage or named as a route's end.");
                }
                catch
                {
                    // A broken log sink must not take the enumeration down with it.
                }
            }
        }
    }

    /// <summary>Two active centres that claimed one id in the same pass, and which of them was kept.</summary>
    public readonly struct CommandCentreIdCollision
    {
        public CommandCentreIdCollision(string id, string keptProviderId, string droppedProviderId)
        {
            Id = id;
            KeptProviderId = keptProviderId;
            DroppedProviderId = droppedProviderId;
        }

        public string Id { get; }

        /// <summary>The <see cref="ICommandCentreSource.ProviderId"/> of the source whose centre was kept.</summary>
        public string KeptProviderId { get; }

        /// <summary>The <see cref="ICommandCentreSource.ProviderId"/> of the source whose centre was dropped.</summary>
        public string DroppedProviderId { get; }
    }
}
