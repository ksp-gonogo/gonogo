using System.Collections.Generic;
using System.Runtime.CompilerServices;

namespace Sitrep.Host
{
    /// <summary>
    /// Assigns and remembers a stable string id per live reference — the
    /// M3 R3 fix for the maneuver-node id gap flagged by
    /// <c>packages/sitrep-client/src/map-command.ts</c>'s
    /// <c>KNOWN_COMMAND_GAPS</c> comment: no read channel carried a per-node
    /// id, so <c>vessel.maneuver.update</c>/<c>.remove</c> only worked for
    /// nodes created THROUGH the command path (tracked in the actuator's own
    /// throwaway <c>Dictionary&lt;string, ManeuverNode&gt;</c>), never a
    /// node the player placed by hand in the map view.
    ///
    /// <para>KSP's own <c>ManeuverNode</c> type has no id field at all
    /// (confirmed via decompile — see <c>Gonogo.KSP.KspHost.BuildManeuverNodes</c>'s
    /// doc comment). <c>Gonogo.KSP.GonogoAddon</c> constructs exactly ONE
    /// <c>ReferenceIdRegistry&lt;ManeuverNode&gt;</c> and hands the SAME
    /// instance to both <c>KspHost</c> (read side — stamps an <c>id</c> onto
    /// every <c>vessel.maneuver</c> node) and <c>KspVesselActuator</c> (write
    /// side — resolves <c>update</c>/<c>remove</c>'s <c>nodeId</c> argument
    /// back to a live node). Sharing one instance is what makes a node's id
    /// the SAME whether it was player-placed or command-created — closing
    /// the round-trip gap, not just adding a cosmetic read-side id that
    /// still can't be sent back into a command.</para>
    ///
    /// <para>Keyed by REFERENCE identity
    /// (<see cref="ConditionalWeakTable{TKey, TValue}"/>), not a derived key
    /// like UT+ordinal: a node's UT changes when it's dragged/updated
    /// (<c>vessel.maneuver.update</c> exists precisely to do that), and its
    /// ordinal position shifts whenever an EARLIER sibling is added or
    /// removed (the exact O-4 arg-order/index-shift footgun this whole
    /// capture-add exists to avoid reproducing) — neither survives the edits
    /// this id exists to survive. <see cref="ConditionalWeakTable{TKey, TValue}"/>
    /// also means a removed/GC'd node's entry is reclaimed automatically —
    /// no manual eviction needed on <c>RemoveManeuverNode</c>/vessel
    /// switch/scene change/quickload.</para>
    ///
    /// <para>Generic and KSP-free ON PURPOSE (BCL-only, this assembly's own
    /// invariant — see this project's csproj comment): the type parameter is
    /// only bound to the real KSP <c>ManeuverNode</c> type where
    /// <c>Gonogo.KSP</c> instantiates it, so this class itself is fully
    /// headless-testable with any reference type stand-in.</para>
    /// </summary>
    public sealed class ReferenceIdRegistry<T> where T : class
    {
        private readonly ConditionalWeakTable<T, string> _ids = new ConditionalWeakTable<T, string>();

        /// <summary>
        /// Returns the SAME id for the SAME instance every time; assigns a
        /// fresh one (a random GUID) the first time a given instance is
        /// seen. <see cref="ConditionalWeakTable{TKey,TValue}.GetValue"/>
        /// has existed since .NET Framework 4.0 / netstandard2.0 alike, so
        /// this needs no per-TFM branching despite this assembly
        /// multi-targeting netstandard2.0/net472.
        /// </summary>
        public string GetOrAssign(T item) => _ids.GetValue(item, _ => System.Guid.NewGuid().ToString());

        /// <summary>
        /// Finds the live instance among <paramref name="candidates"/> whose
        /// assigned id equals <paramref name="id"/> — the write-side half of
        /// the round-trip: an update/remove command carries only the opaque
        /// id, never a reference, so the actuator re-resolves it against
        /// whatever KSP's live <c>solver.maneuverNodes</c> currently holds.
        /// A candidate this registry has never seen (no entry yet — e.g. a
        /// node created after the last read-side sample) never matches,
        /// same as one that's simply the wrong node -- both fail the same
        /// way, no exception.
        /// </summary>
        public bool TryResolve(string id, IEnumerable<T> candidates, out T? item)
        {
            foreach (var candidate in candidates)
            {
                if (candidate != null && _ids.TryGetValue(candidate, out var existing) && existing == id)
                {
                    item = candidate;
                    return true;
                }
            }
            item = null;
            return false;
        }
    }
}
