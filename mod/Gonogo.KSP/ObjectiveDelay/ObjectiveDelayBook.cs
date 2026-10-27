using System;
using System.Collections.Generic;
using System.Globalization;
using Sitrep.Contract;
using Sitrep.Host.Comms;

namespace Gonogo.KSP.ObjectiveDelay
{
    /// <summary>What becomes of an objective change offered to the line.</summary>
    public enum ObjectiveOffer
    {
        /// <summary>The change takes effect now: delay is off, or it names no source craft.</summary>
        ApplyNow,

        /// <summary>The change is on the line and takes effect when word of it reaches home.</summary>
        Held,

        /// <summary>The objective is already on its way to this state, so nothing new is held.</summary>
        Absorbed,
    }

    /// <summary>How a change left the line.</summary>
    public enum ObjectiveSettlement
    {
        Applied,
        Dropped,
    }

    /// <summary>Home's view of the contract a change is for, read the moment the change arrives.</summary>
    public readonly struct ContractView
    {
        public ContractView(bool readable, bool found, bool active, double? deadlineUt, bool objectiveFound, ObjectiveState? objectiveState)
        {
            Readable = readable;
            Found = found;
            Active = active;
            DeadlineUt = deadlineUt;
            ObjectiveFound = objectiveFound;
            ObjectiveState = objectiveState;
        }

        /// <summary>A view with no contract system loaded yet: every arrival waits.</summary>
        public static ContractView Unreadable => new ContractView(false, false, false, null, false, null);

        /// <summary>Whether the contract system is loaded, so an absent contract means one that is gone.</summary>
        public bool Readable { get; }

        public bool Found { get; }

        public bool Active { get; }

        /// <summary>The contract's deadline, or null when it has none.</summary>
        public double? DeadlineUt { get; }

        public bool ObjectiveFound { get; }

        /// <summary>The objective's state at home, or null when it is in a state none of the three targets names.</summary>
        public ObjectiveState? ObjectiveState { get; }
    }

    /// <summary>One change on the line.</summary>
    public sealed class HeldObjective
    {
        internal HeldObjective(ObjectiveChange change, long seq, double? arrivesUt, List<string> unheardSources, Action? apply)
        {
            Change = change;
            Seq = seq;
            ArrivesUt = arrivesUt;
            UnheardSources = unheardSources;
            Apply = apply;
        }

        public ObjectiveChange Change { get; }

        /// <summary>The order the change was taken in, breaking a tie between two changes stamped at the same instant.</summary>
        public long Seq { get; }

        /// <summary>
        /// When word from every source craft with a route has reached home, or
        /// null while none has. The change still waits for each craft in
        /// <see cref="UnheardSources"/>.
        /// </summary>
        public double? ArrivesUt { get; internal set; }

        /// <summary>Source craft that had no route home when the change happened, and that home has not yet heard from since.</summary>
        public List<string> UnheardSources { get; }

        /// <summary>How to make the change, or null for one a load restored and its owner has not yet given back.</summary>
        public Action? Apply { get; internal set; }

        /// <summary>The key this change is named by on the wire, the same on its pending row and on its settlement.</summary>
        public string Key => KeyOf(Change);

        public static string KeyOf(ObjectiveChange change) =>
            change.ContractId.ToString("N")
            + "/" + change.ObjectivePath
            + "/" + change.Target
            + "@" + change.CraftUt.ToString("R", CultureInfo.InvariantCulture);
    }

    /// <summary>A change that left the line, as home acted on it.</summary>
    public readonly struct SettledObjective
    {
        public SettledObjective(string key, Guid contractId, ObjectiveSettlement outcome, double settledUt)
        {
            Key = key;
            ContractId = contractId;
            Outcome = outcome;
            SettledUt = settledUt;
        }

        public string Key { get; }

        public Guid ContractId { get; }

        public ObjectiveSettlement Outcome { get; }

        public double SettledUt { get; }
    }

    /// <summary>
    /// The delay line contract objectives cross on their way home: holds each
    /// change of an objective's state until word of it reaches home from the
    /// craft that caused it, then applies it if the contract can still take it
    /// and drops it otherwise.
    ///
    /// <para>No KSP types and no live reads: every fact about a craft or a
    /// contract arrives through a delegate, so the whole decision runs
    /// headlessly.</para>
    ///
    /// <para>The rules:</para>
    /// <list type="bullet">
    /// <item>a change from a craft with a route home arrives after that
    /// craft's delay; one from two craft arrives after the later of the two</item>
    /// <item>a change from a craft with no route waits for word from it sent at
    /// or after the change. Home knowing the craft gone, or declaring it lost,
    /// with no such word drops the change</item>
    /// <item>a change never takes effect ahead of an earlier one from the same
    /// craft or for the same objective</item>
    /// <item>on arrival, a change for a contract no longer active, stamped after
    /// the contract's deadline, or that the objective's state has already
    /// overtaken, is dropped without its apply being called</item>
    /// </list>
    /// </summary>
    public sealed class ObjectiveDelayBook
    {
        /// <summary>How many settlements <see cref="Settled"/> keeps, newest last.</summary>
        public const int SettledKept = 64;

        private readonly List<HeldObjective> _held = new List<HeldObjective>();
        private readonly List<SettledObjective> _settled = new List<SettledObjective>();
        private readonly Dictionary<string, Func<ObjectiveChange, Action?>> _owners =
            new Dictionary<string, Func<ObjectiveChange, Action?>>(StringComparer.Ordinal);

        private long _nextSeq;

        /// <summary>Every change still on the line, in the order taken.</summary>
        public IReadOnlyList<HeldObjective> Held => _held;

        /// <summary>The most recent changes home has acted on, oldest first, at most <see cref="SettledKept"/>.</summary>
        public IReadOnlyList<SettledObjective> Settled => _settled;

        /// <summary>Whether an owner has bound under <paramref name="ownerId"/>.</summary>
        public bool IsBound(string ownerId) => _owners.ContainsKey(ownerId ?? "");

        /// <summary>
        /// Offers one change to the line.
        /// </summary>
        /// <param name="delayModelled">Whether signal delay is switched on.</param>
        /// <param name="secondsToHome">A source craft's one-way delay to home, or null when it has no route.</param>
        public ObjectiveOffer Offer(
            ObjectiveChange change,
            Action? apply,
            bool delayModelled,
            Func<string, double?> secondsToHome)
        {
            if (change == null) throw new ArgumentNullException(nameof(change));
            if (secondsToHome == null) throw new ArgumentNullException(nameof(secondsToHome));

            var sources = DistinctSources(change.SourceVesselIds);
            if (!delayModelled || sources.Count == 0)
            {
                return ObjectiveOffer.ApplyNow;
            }

            var latest = LatestFor(change.ContractId, change.ObjectivePath);
            if (latest != null && latest.Change.Target == change.Target)
            {
                return ObjectiveOffer.Absorbed;
            }

            double? arrives = null;
            var unheard = new List<string>();
            foreach (var source in sources)
            {
                var seconds = secondsToHome(source);
                if (seconds is double routed)
                {
                    var at = change.CraftUt + Math.Max(0.0, routed);
                    arrives = arrives is double so && so >= at ? so : at;
                }
                else
                {
                    unheard.Add(source);
                }
            }

            _held.Add(new HeldObjective(Normalised(change, sources), _nextSeq++, arrives, unheard, apply));
            return ObjectiveOffer.Held;
        }

        /// <summary>Whether any change for the contract stamped at or before <paramref name="ut"/> is still on the line.</summary>
        public bool HasHeldAtOrBefore(Guid contractId, double ut)
        {
            foreach (var held in _held)
            {
                if (held.Change.ContractId == contractId && held.Change.CraftUt <= ut)
                {
                    return true;
                }
            }
            return false;
        }

        /// <summary>
        /// Registers how <paramref name="ownerId"/> applies its restored
        /// changes, and gives each restored change of that owner its apply now.
        /// A change the resolver cannot reach is dropped at its next arrival.
        /// </summary>
        public void Rebind(string ownerId, Func<ObjectiveChange, Action?> resolve)
        {
            if (resolve == null) throw new ArgumentNullException(nameof(resolve));
            _owners[ownerId ?? ""] = resolve;
            foreach (var held in _held)
            {
                if (held.Apply == null && string.Equals(held.Change.OwnerId, ownerId ?? "", StringComparison.Ordinal))
                {
                    held.Apply = resolve(held.Change);
                }
            }
        }

        /// <summary>
        /// Puts back a change a save held, with no apply until its owner
        /// rebinds. A change already on the line under the same key is not
        /// added twice.
        /// </summary>
        public void Restore(ObjectiveChange change, double? arrivesUt, IEnumerable<string> unheardSources)
        {
            if (change == null) throw new ArgumentNullException(nameof(change));
            var key = HeldObjective.KeyOf(change);
            foreach (var held in _held)
            {
                if (held.Key == key)
                {
                    return;
                }
            }
            var restored = new HeldObjective(change, _nextSeq++, arrivesUt, new List<string>(unheardSources ?? Array.Empty<string>()), apply: null);
            if (_owners.TryGetValue(change.OwnerId ?? "", out var resolve))
            {
                restored.Apply = resolve(change);
            }
            _held.Add(restored);
        }

        /// <summary>
        /// Brings every change forward: what is left until each arrives is
        /// multiplied by <paramref name="remainingFactor"/>. A factor of 0,
        /// signal delay switched off, also lets every change waiting on a craft
        /// with no route arrive now. A factor of 1 or more changes nothing.
        /// </summary>
        public void BringForward(double nowUt, double remainingFactor)
        {
            if (double.IsNaN(remainingFactor) || remainingFactor >= 1.0)
            {
                return;
            }
            var factor = Math.Max(0.0, remainingFactor);
            foreach (var held in _held)
            {
                if (factor == 0.0)
                {
                    held.UnheardSources.Clear();
                    held.ArrivesUt = held.ArrivesUt is double at ? Math.Min(at, nowUt) : nowUt;
                    continue;
                }
                if (held.ArrivesUt is double arrives && arrives > nowUt)
                {
                    held.ArrivesUt = nowUt + ((arrives - nowUt) * factor);
                }
            }
        }

        /// <summary>
        /// Lets every change whose word has reached home take effect, in the
        /// order the craft made them, and drops each that home now knows will
        /// never be heard or that the contract can no longer take.
        /// </summary>
        /// <param name="homeView">Home's view of a source craft, or null while it has no word of it.</param>
        /// <param name="contractView">Home's view of the change's contract, read just before the change would apply.</param>
        /// <param name="onApplyFailed">Told of an apply that threw; the change is dropped.</param>
        public void Release(
            double nowUt,
            Func<string, HomeCraftView?> homeView,
            Func<ObjectiveChange, ContractView> contractView,
            Action<ObjectiveChange, Exception>? onApplyFailed = null)
        {
            if (homeView == null) throw new ArgumentNullException(nameof(homeView));
            if (contractView == null) throw new ArgumentNullException(nameof(contractView));

            HearUnroutedSources(nowUt, homeView);

            var order = new List<HeldObjective>(_held);
            order.Sort(CraftOrder);
            var blocked = new List<HeldObjective>();
            foreach (var held in order)
            {
                if (!_held.Contains(held))
                {
                    continue;
                }
                if (!HasArrived(held, nowUt) || BlockedBy(held, blocked))
                {
                    blocked.Add(held);
                    continue;
                }

                var apply = held.Apply;
                if (apply == null)
                {
                    if (!_owners.ContainsKey(held.Change.OwnerId ?? ""))
                    {
                        blocked.Add(held);
                        continue;
                    }
                    Settle(held, ObjectiveSettlement.Dropped, nowUt);
                    continue;
                }

                var verdict = Arrival(held.Change, contractView(held.Change));
                if (verdict == ObjectiveSettlement.Dropped)
                {
                    Settle(held, ObjectiveSettlement.Dropped, nowUt);
                    continue;
                }
                if (verdict == null)
                {
                    blocked.Add(held);
                    continue;
                }

                try
                {
                    apply();
                    Settle(held, ObjectiveSettlement.Applied, nowUt);
                }
                catch (Exception ex)
                {
                    Settle(held, ObjectiveSettlement.Dropped, nowUt);
                    onApplyFailed?.Invoke(held.Change, ex);
                }
            }
        }

        /// <summary>
        /// What a change that has reached home does to its contract: applied,
        /// dropped, or null to wait because the contract system cannot be read
        /// yet.
        /// </summary>
        public static ObjectiveSettlement? Arrival(ObjectiveChange change, ContractView view)
        {
            if (!view.Readable)
            {
                return null;
            }
            if (!view.Found || !view.Active || !view.ObjectiveFound)
            {
                return ObjectiveSettlement.Dropped;
            }
            if (view.DeadlineUt is double deadline && change.CraftUt > deadline)
            {
                return ObjectiveSettlement.Dropped;
            }
            /*
             * The game's own methods do not refuse these: SetComplete turns a
             * failed objective complete and pays for it, so the line refuses
             * anything that would move an objective out of failure or repeat
             * the state it is already in.
             */
            var current = view.ObjectiveState;
            if (current == Sitrep.Contract.ObjectiveState.Failed || current == change.Target)
            {
                return ObjectiveSettlement.Dropped;
            }
            return ObjectiveSettlement.Applied;
        }

        private void HearUnroutedSources(double nowUt, Func<string, HomeCraftView?> homeView)
        {
            for (var i = 0; i < _held.Count; i++)
            {
                var held = _held[i];
                if (held.UnheardSources.Count == 0)
                {
                    continue;
                }
                var dropped = false;
                for (var s = 0; s < held.UnheardSources.Count; s++)
                {
                    var word = WordFrom(held.Change.CraftUt, homeView(held.UnheardSources[s]));
                    if (word == SourceWord.Waits)
                    {
                        continue;
                    }
                    if (word == SourceWord.NeverComes)
                    {
                        dropped = true;
                        break;
                    }
                    held.UnheardSources.RemoveAt(s);
                    s--;
                    held.ArrivesUt = held.ArrivesUt is double at ? Math.Max(at, nowUt) : nowUt;
                }
                if (dropped)
                {
                    Settle(held, ObjectiveSettlement.Dropped, nowUt);
                    i--;
                }
            }
        }

        private enum SourceWord
        {
            Waits,
            Heard,
            NeverComes,
        }

        /// <summary>
        /// Word from a craft that had no route when it acted: heard once home
        /// holds contact from it sent at or after the change; never coming once
        /// home knows it is gone, or has declared it lost, without that word.
        /// </summary>
        private static SourceWord WordFrom(double craftUt, HomeCraftView? view)
        {
            if (view is not HomeCraftView home)
            {
                return SourceWord.Waits;
            }
            var heard = home.LastContactUt is double last && last >= craftUt;
            var gone = home.Contact == CentreContactState.Gone || home.Verdict == HomeVerdictState.Gone;
            if (heard && (home.Contact == CentreContactState.InContact || gone))
            {
                return SourceWord.Heard;
            }
            if (gone || home.Verdict == HomeVerdictState.Lost)
            {
                return SourceWord.NeverComes;
            }
            return SourceWord.Waits;
        }

        private static bool HasArrived(HeldObjective held, double nowUt) =>
            held.UnheardSources.Count == 0 && held.ArrivesUt is double at && at <= nowUt;

        private static bool BlockedBy(HeldObjective held, List<HeldObjective> earlier)
        {
            foreach (var other in earlier)
            {
                if (SameObjective(held.Change, other.Change) || ShareSource(held.Change, other.Change))
                {
                    return true;
                }
            }
            return false;
        }

        private static bool SameObjective(ObjectiveChange a, ObjectiveChange b) =>
            a.ContractId == b.ContractId && string.Equals(a.ObjectivePath, b.ObjectivePath, StringComparison.Ordinal);

        private static bool ShareSource(ObjectiveChange a, ObjectiveChange b)
        {
            foreach (var source in a.SourceVesselIds)
            {
                foreach (var other in b.SourceVesselIds)
                {
                    if (string.Equals(source, other, StringComparison.Ordinal))
                    {
                        return true;
                    }
                }
            }
            return false;
        }

        private static int CraftOrder(HeldObjective a, HeldObjective b)
        {
            var byUt = a.Change.CraftUt.CompareTo(b.Change.CraftUt);
            return byUt != 0 ? byUt : a.Seq.CompareTo(b.Seq);
        }

        private HeldObjective? LatestFor(Guid contractId, string path)
        {
            HeldObjective? latest = null;
            foreach (var held in _held)
            {
                if (held.Change.ContractId != contractId || !string.Equals(held.Change.ObjectivePath, path, StringComparison.Ordinal))
                {
                    continue;
                }
                if (latest == null || CraftOrder(held, latest) > 0)
                {
                    latest = held;
                }
            }
            return latest;
        }

        private void Settle(HeldObjective held, ObjectiveSettlement outcome, double nowUt)
        {
            _held.Remove(held);
            _settled.Add(new SettledObjective(held.Key, held.Change.ContractId, outcome, nowUt));
            if (_settled.Count > SettledKept)
            {
                _settled.RemoveRange(0, _settled.Count - SettledKept);
            }
        }

        private static List<string> DistinctSources(IReadOnlyList<string>? sources)
        {
            var distinct = new List<string>();
            if (sources == null)
            {
                return distinct;
            }
            foreach (var source in sources)
            {
                if (!string.IsNullOrEmpty(source) && !distinct.Contains(source))
                {
                    distinct.Add(source);
                }
            }
            return distinct;
        }

        /// <summary>A copy the caller cannot change under the line, with its sources de-duplicated.</summary>
        private static ObjectiveChange Normalised(ObjectiveChange change, List<string> sources) =>
            new ObjectiveChange
            {
                ContractId = change.ContractId,
                OwnerId = change.OwnerId ?? "",
                ObjectivePath = change.ObjectivePath ?? "",
                Target = change.Target,
                SourceVesselIds = sources.ToArray(),
                CraftUt = change.CraftUt,
                Description = change.Description ?? "",
            };
    }
}
