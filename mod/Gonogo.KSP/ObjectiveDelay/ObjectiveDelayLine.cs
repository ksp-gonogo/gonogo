using System;
using System.Collections.Generic;
using Gonogo.KSP.CurrencyDelay;
using Sitrep.Contract;

namespace Gonogo.KSP.ObjectiveDelay
{
    /// <summary>
    /// The live objective delay line: the current save's
    /// <see cref="ObjectiveDelayBook"/>, bound by <see cref="CurrencyDelayScenario"/>
    /// while one is loaded, and the owners that know how to apply a restored
    /// change, which outlive any one save because an Uplink binds once, when it
    /// registers.
    ///
    /// <para>Unbound, at the main menu or before a scenario has woken, every
    /// change applies at once and nothing is held open.</para>
    /// </summary>
    public static class ObjectiveDelayLine
    {
        private static ObjectiveDelayBook? _book;
        private static readonly Dictionary<string, Func<ObjectiveChange, Action?>> Owners =
            new Dictionary<string, Func<ObjectiveChange, Action?>>(StringComparer.Ordinal);

        /// <summary>Set while the line applies a change, so the hook that held it lets the game make it this time.</summary>
        public static CurrencyDelayGuard Replaying { get; } = new CurrencyDelayGuard();

        /// <summary>Raised on the game's thread for each change the line takes in.</summary>
        public static event Action<HeldObjective>? Taken;

        public static ObjectiveDelayBook? Book => _book;

        /// <summary>
        /// Home's view of a change's contract, read just before it applies. Set by the
        /// stock hooks when they install; until then every arrival waits.
        /// </summary>
        public static Func<ObjectiveChange, ContractView> ContractViewOf { get; set; } = _ => ContractView.Unreadable;

        public static void Bind(ObjectiveDelayBook book)
        {
            _book = book ?? throw new ArgumentNullException(nameof(book));
            foreach (var owner in Owners)
            {
                book.Rebind(owner.Key, owner.Value);
            }
        }

        public static void Unbind(ObjectiveDelayBook book)
        {
            if (ReferenceEquals(_book, book))
            {
                _book = null;
            }
        }

        public static bool IsBound(string ownerId) => Owners.ContainsKey(ownerId ?? "");

        /// <summary>Whether the objective has a change on the line, so a repeat of its home state is still a transition.</summary>
        public static bool HasPendingFor(Guid contractId, string objectivePath)
        {
            var book = _book;
            if (book == null)
            {
                return false;
            }
            foreach (var held in book.Held)
            {
                if (held.Change.ContractId == contractId
                    && string.Equals(held.Change.ObjectivePath, objectivePath, StringComparison.Ordinal))
                {
                    return true;
                }
            }
            return false;
        }

        public static bool Hold(ObjectiveChange change, Action apply)
        {
            var book = _book;
            if (book == null || change == null || apply == null)
            {
                return false;
            }
            try
            {
                var config = CommsCoreUplink.SignalDelayConfig;
                var before = book.Held.Count;
                var offer = book.Offer(
                    change,
                    apply,
                    KscDelayPolicy.Enabled(config),
                    vesselId =>
                    {
                        var delay = KscLightTime.ForVesselId(vesselId, config);
                        return delay.IsUnroutable ? (double?)null : KscDelayPolicy.DelaySeconds(delay, config);
                    });
                if (offer == ObjectiveOffer.Held && book.Held.Count > before)
                {
                    Taken?.Invoke(book.Held[book.Held.Count - 1]);
                }
                return offer != ObjectiveOffer.ApplyNow;
            }
            catch (Exception ex)
            {
                GonogoLog.WarnLimited("ObjectiveDelayLine.Hold failed (applying the change now)", ex);
                return false;
            }
        }

        public static bool HasHeldAtOrBefore(Guid contractId, double ut) =>
            _book != null && _book.HasHeldAtOrBefore(contractId, ut);

        public static void Rebind(string ownerId, Func<ObjectiveChange, Action?> resolve)
        {
            if (resolve == null) throw new ArgumentNullException(nameof(resolve));
            Owners[ownerId ?? ""] = resolve;
            _book?.Rebind(ownerId ?? "", resolve);
        }
    }

    /// <summary>
    /// The <c>"objectiveDelay"</c> capability's active instance: the published
    /// face of <see cref="ObjectiveDelayLine"/>, registered as the capability's
    /// Vanilla factory by <see cref="CurrencyEventUplink.DeclareCapabilities"/>.
    /// </summary>
    public sealed class ObjectiveDelayLineBackend : IObjectiveDelayLine
    {
        public string ProviderId => "gonogo-objective-delay";

        public bool Hold(ObjectiveChange change, Action apply) => ObjectiveDelayLine.Hold(change, apply);

        public bool HasHeldAtOrBefore(Guid contractId, double ut) => ObjectiveDelayLine.HasHeldAtOrBefore(contractId, ut);

        public void Rebind(string ownerId, Func<ObjectiveChange, Action?> resolve) => ObjectiveDelayLine.Rebind(ownerId, resolve);
    }
}
