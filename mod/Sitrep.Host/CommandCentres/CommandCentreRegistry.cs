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
        private readonly List<ICommandCentreSource> _seatSources = new List<ICommandCentreSource>();
        private readonly List<ICommandCentreSource> _listenerSources = new List<ICommandCentreSource>();
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

        /// <summary>
        /// Registers a source of seats: the craft a session can stand aboard without
        /// that craft being a command centre. A seat is read like a centre (the same
        /// id scheme, the same routing node) but is never part of
        /// <see cref="EnumerateActive"/>, so it reaches no roster, no home election
        /// and no vantage picker.
        /// </summary>
        public void RegisterSeatSource(ICommandCentreSource source) => _seatSources.Add(source);

        /// <summary>
        /// Registers a source of listeners: craft that can be sent a message and
        /// nothing else. A listener is listed on the roster as not commandable and not
        /// active, is timed from every active centre, and is never part of
        /// <see cref="EnumerateActive"/>, so it reaches no home election, no vantage
        /// picker, no command right and no delay row of any centre.
        /// </summary>
        public void RegisterListenerSource(ICommandCentreSource source) => _listenerSources.Add(source);

        /// <summary>The id collisions the most recent <see cref="EnumerateActive"/> pass dropped a centre for.</summary>
        public IReadOnlyList<CommandCentreIdCollision> Collisions => _collisions;

        /// <summary>
        /// Flatten every source's live enumeration, keep only <see cref="ICommandCentre.IsActiveNow"/>
        /// centres, and dedupe by <see cref="ICommandCentre.Id"/> (first registered wins, and every
        /// later claimant is recorded as a <see cref="CommandCentreIdCollision"/>).
        /// </summary>
        public IReadOnlyList<ICommandCentre> EnumerateActive()
        {
            var held = _passResult;
            if (held != null)
            {
                return held;
            }

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

            if (_passOpen)
            {
                _passResult = result;
            }

            return result;
        }

        /// <summary>
        /// The seats a session can stand at now: every active seat from the seat
        /// sources, minus any whose id is already an active centre (a craft that is a
        /// command centre is that centre, not a seat as well), deduped by id.
        /// </summary>
        public IReadOnlyList<ICommandCentre> EnumerateSeats()
        {
            var held = _seatPassResult;
            if (held != null)
            {
                return held;
            }

            var taken = new HashSet<string>(StringComparer.Ordinal);
            foreach (var centre in EnumerateActive())
            {
                taken.Add(centre.Id);
            }

            var result = new List<ICommandCentre>();
            foreach (var seat in ReadSeats())
            {
                if (taken.Add(seat.Id))
                {
                    result.Add(seat);
                }
            }

            if (_passOpen)
            {
                _seatPassResult = result;
            }

            return result;
        }

        /// <summary>
        /// The listeners now: every craft the listener sources name, minus any whose
        /// id is already an active centre (that craft is the centre, not a listener as
        /// well), deduped by id.
        /// </summary>
        public IReadOnlyList<ICommandCentre> EnumerateListeners()
        {
            var held = _listenerPassResult;
            if (held != null)
            {
                return held;
            }

            var taken = new HashSet<string>(StringComparer.Ordinal);
            foreach (var centre in EnumerateActive())
            {
                taken.Add(centre.Id);
            }

            var result = new List<ICommandCentre>();
            foreach (var source in _listenerSources)
            {
                foreach (var listener in source.Enumerate())
                {
                    if (taken.Add(listener.Id))
                    {
                        result.Add(listener);
                    }
                }
            }

            if (_passOpen)
            {
                _listenerPassResult = result;
            }

            return result;
        }

        /// <summary>
        /// The id of the first active seat, whether or not that id is also an active
        /// centre, or null when no seat source has one. For the active craft this is
        /// where a session that follows it stands.
        /// </summary>
        public string? FirstSeatId()
        {
            var seats = ReadSeats();
            return seats.Count == 0 ? null : seats[0].Id;
        }

        private IReadOnlyList<ICommandCentre> ReadSeats()
        {
            var held = _rawSeatPassResult;
            if (held != null)
            {
                return held;
            }

            var seen = new HashSet<string>(StringComparer.Ordinal);
            var result = new List<ICommandCentre>();
            foreach (var source in _seatSources)
            {
                foreach (var seat in source.Enumerate())
                {
                    if (seat.IsActiveNow() && seen.Add(seat.Id))
                    {
                        result.Add(seat);
                    }
                }
            }

            if (_passOpen)
            {
                _rawSeatPassResult = result;
            }

            return result;
        }

        private volatile IReadOnlyList<ICommandCentre>? _passResult;
        private volatile IReadOnlyList<ICommandCentre>? _seatPassResult;
        private volatile IReadOnlyList<ICommandCentre>? _rawSeatPassResult;
        private volatile IReadOnlyList<ICommandCentre>? _listenerPassResult;
        private volatile bool _passOpen;

        /// <summary>
        /// Opens a pass: until <see cref="EndPass"/>, every <see cref="EnumerateActive"/> call
        /// returns the one enumeration the first of them made. The game's main thread opens it
        /// around the captures of one tick, which all read the same instant, so the sources are
        /// walked once for the tick instead of once per reader.
        /// </summary>
        public void BeginPass()
        {
            _passResult = null;
            _seatPassResult = null;
            _rawSeatPassResult = null;
            _listenerPassResult = null;
            _passOpen = true;
        }

        /// <summary>Closes the pass opened by <see cref="BeginPass"/>, so the next call enumerates afresh.</summary>
        public void EndPass()
        {
            _passOpen = false;
            _passResult = null;
            _seatPassResult = null;
            _rawSeatPassResult = null;
            _listenerPassResult = null;
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
