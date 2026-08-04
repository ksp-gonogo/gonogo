using System.Collections.Generic;

namespace Sitrep.Host.CommandCentres
{
    /// <summary>
    /// Holds the registered command-centre sources and enumerates the currently
    /// active centres each pass. Sources are re-enumerated live on every
    /// <see cref="EnumerateActive"/> call (a dynamic source such as a crewed
    /// control vessel appears/disappears/moves between passes). "The set of
    /// authorities" is literally the flattened, active, id-deduped enumeration.
    /// </summary>
    public sealed class CommandCentreRegistry
    {
        private readonly List<ICommandCentreSource> _sources = new List<ICommandCentreSource>();

        public void RegisterSource(ICommandCentreSource source) => _sources.Add(source);

        /// <summary>
        /// Flatten every source's live enumeration, keep only <see cref="ICommandCentre.IsActiveNow"/>
        /// centres, and dedupe by <see cref="ICommandCentre.Id"/> (first registered wins).
        /// </summary>
        public IReadOnlyList<ICommandCentre> EnumerateActive()
        {
            var seen = new HashSet<string>();
            var result = new List<ICommandCentre>();
            foreach (var source in _sources)
            {
                foreach (var centre in source.Enumerate())
                {
                    if (!centre.IsActiveNow())
                    {
                        continue;
                    }

                    if (!seen.Add(centre.Id))
                    {
                        continue;
                    }

                    result.Add(centre);
                }
            }

            return result;
        }
    }
}
