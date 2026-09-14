using System;
using System.Collections.Generic;

namespace Sitrep.Contract
{
    /// <summary>
    /// The exclusive capability id every home-command claimant competes for.
    /// </summary>
    /// <remarks>
    /// Declared in the contract rather than beside the election so an Uplink,
    /// which may reference only this assembly, registers against the same
    /// constant core declares.
    ///
    /// <para><b>How a claimant registers.</b> Any registered provider that can
    /// serve beats the stock vanilla outright, whatever its priority. Between two
    /// or more registered providers the kernel takes a user preference first,
    /// then a sole <see cref="ProviderRegistration.IsDefault"/> provider, then the
    /// unique highest <see cref="ProviderRegistration.Priority"/>. A tie at the
    /// top, or two <c>IsDefault</c> providers, is ambiguous: the home command is
    /// left with NO claimant, not even the stock one, and the kernel reports an
    /// "ambiguous" <see cref="ResolutionNotice"/> naming each tied provider.
    /// Other capabilities still resolve.</para>
    ///
    /// <para>So two claimants that can be installed together must register at
    /// DISTINCT priorities, the one that should win strictly higher, and neither
    /// may set <c>IsDefault</c>, which would override priority. A career-overhaul
    /// claimant that knows which space centre holds the ledger outranks a comms
    /// claimant that can only pick among ground stations: for example the comms
    /// claimant at 10 and the career overhaul at 20. A claimant
    /// that cannot serve on this install should withdraw through
    /// <see cref="ProviderRegistration.CanServe"/>, which lets the runner-up win,
    /// rather than winning and answering <see cref="HomeCommand.NotIdentified"/>:
    /// the election is decided once at resolve time, and an elected claimant's
    /// per-tick "not identified" does not fall through to anyone else.</para>
    /// </remarks>
    public static class HomeCommandCapability
    {
        /// <summary>The capability id. One declaration, reachable from an Uplink.</summary>
        public const string Id = "homeCommand";
    }

    /// <summary>
    /// Which command centre holds the career ledger: the one centre that receives
    /// funds and makes spending choices. Any centre may issue commands; only home
    /// is the career's.
    ///
    /// <para>An answer is either a command-centre id, the same id
    /// <see cref="ICommandCentre.Id"/> carries, or <see cref="NotIdentified"/>.
    /// Not identified is an honest answer rather than a failure: on an install
    /// whose ground stations all look alike to the elected claimant, it cannot say
    /// which of them is home, and a guess would put the ledger somewhere it is
    /// not.</para>
    ///
    /// <para>Immutable, so an answer captured on one thread is safe to read on any
    /// other.</para>
    /// </summary>
    public sealed class HomeCommand
    {
        /// <summary>The claimant cannot say which centre is home.</summary>
        public static readonly HomeCommand NotIdentified = new HomeCommand(null);

        private HomeCommand(string? centreId) => CentreId = centreId;

        /// <summary>Home is the command centre whose id is <paramref name="centreId"/>.</summary>
        /// <exception cref="ArgumentException">
        /// <paramref name="centreId"/> is null or empty. An absent id is
        /// <see cref="NotIdentified"/>, never an identified answer with nothing in it.
        /// </exception>
        public static HomeCommand Identified(string centreId)
        {
            if (string.IsNullOrEmpty(centreId))
            {
                throw new ArgumentException("An identified home names a command centre.", nameof(centreId));
            }

            return new HomeCommand(centreId);
        }

        /// <summary>Whether the claimant named a home.</summary>
        public bool IsIdentified => CentreId != null;

        /// <summary>The home centre's id when <see cref="IsIdentified"/>, otherwise null.</summary>
        public string? CentreId { get; }

        public override string ToString() => CentreId ?? "not identified";
    }

    /// <summary>
    /// The active instance of the exclusive <c>"homeCommand"</c> capability: the
    /// logic that decides which command centre is home on this install.
    ///
    /// <para>Nothing but the elected claimant decides who is home. Everything
    /// else asks for its answer and never reads the game's own home flags to
    /// work it out again.</para>
    /// </summary>
    public interface IHomeCommandProvider : ISitrepProvider
    {
        /// <summary>
        /// Which command centre is home right now, or
        /// <see cref="HomeCommand.NotIdentified"/>. Never null.
        ///
        /// <para>Reads live game state, so it is called only on the main thread,
        /// in the same capture that snapshots the active command centres; a
        /// reader on another thread takes that snapshot instead of calling this.</para>
        /// </summary>
        /// <param name="activeCentres">
        /// The command centres that capture found active, every kind included. A
        /// claimant names home by answering with one of their
        /// <see cref="ICommandCentre.Id"/>s rather than spelling an id itself: core
        /// mints every id, so an id copied from here is the one the roster carries
        /// and one built by hand may not be (two stations that share a name are told
        /// apart by a suffix only core can hand out).
        /// </param>
        HomeCommand Identify(IReadOnlyList<ICommandCentre> activeCentres);
    }
}
