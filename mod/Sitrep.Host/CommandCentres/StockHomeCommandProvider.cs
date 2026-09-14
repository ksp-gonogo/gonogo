using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.CommandCentres
{
    /// <summary>
    /// The stock home-command claimant, and the vanilla of
    /// <see cref="HomeCommandElection"/>: home is the CommNet home that ALONE
    /// carries <c>isKSC</c>.
    ///
    /// <para>No flagged home, or more than one, is
    /// <see cref="HomeCommand.NotIdentified"/>. A comms mod can flag every
    /// station it configures, and a flag every station carries names none of
    /// them; choosing among them is that mod's claimant's job, not a guess this
    /// one makes.</para>
    ///
    /// <para>The answer is the id <see cref="HomeCentreIds.Mint"/> gives that
    /// home across the same set of homes, so it is always the id the command
    /// centre registry carries for it, whatever the minting rule becomes.</para>
    ///
    /// <para>This is the one place in the mod that reads <c>isKSC</c> to decide
    /// who is home. Everything else uses the elected claimant's answer.</para>
    /// </summary>
    public sealed class StockHomeCommandProvider : IHomeCommandProvider
    {
        public const string Id = "stock";

        private readonly Func<IReadOnlyList<HomeNodeFacts>> _homes;

        /// <param name="homes">
        /// Every CommNet home in the scene, read live. Called from
        /// <see cref="Identify"/>, so on the main thread only.
        /// </param>
        public StockHomeCommandProvider(Func<IReadOnlyList<HomeNodeFacts>> homes) =>
            _homes = homes ?? throw new ArgumentNullException(nameof(homes));

        public string ProviderId => Id;

        /// <summary>
        /// Decides from the homes' own flags, which the active centres do not carry,
        /// so <paramref name="activeCentres"/> goes unread. The id still comes from
        /// core's own mint over the same homes.
        /// </summary>
        public HomeCommand Identify(IReadOnlyList<ICommandCentre> activeCentres)
        {
            var homes = _homes();
            if (homes == null)
            {
                return HomeCommand.NotIdentified;
            }

            var home = -1;
            for (var i = 0; i < homes.Count; i++)
            {
                if (!homes[i].IsKsc)
                {
                    continue;
                }

                if (home >= 0)
                {
                    return HomeCommand.NotIdentified;
                }

                home = i;
            }

            return home < 0
                ? HomeCommand.NotIdentified
                : HomeCommand.Identified(HomeCentreIds.Mint(homes)[home]);
        }
    }
}
