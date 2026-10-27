using System;
using System.Reflection;
using Contracts;
using HarmonyLib;
using Sitrep.Contract;

namespace Gonogo.KSP.ObjectiveDelay
{
    /// <summary>
    /// The stock half of the objective delay line: Harmony prefixes on the three
    /// methods every stock and Fine Print objective changes state through, and on
    /// <c>Contract.Update</c>'s deadline, plus the route that finds an objective
    /// again by its contract and path and makes a held change through the game's
    /// own method.
    ///
    /// <para>The objective's live <c>state</c> always means what home knows. A
    /// change from the craft being flown waits on the line, and the objective
    /// keeps asking every frame; the line absorbs the repeats.</para>
    /// </summary>
    internal static class StockObjectiveHooks
    {
        private const string HarmonyId = "gonogo.objectivedelay";

        private static readonly MethodInfo? SetCompleteMethod = AccessTools.Method(typeof(ContractParameter), "SetComplete");
        private static readonly MethodInfo? SetIncompleteMethod = AccessTools.Method(typeof(ContractParameter), "SetIncomplete");
        private static readonly MethodInfo? SetFailedMethod = AccessTools.Method(typeof(ContractParameter), "SetFailed");
        private static readonly MethodInfo? UpdateMethod = AccessTools.Method(typeof(Contract), nameof(Contract.Update));

        private static readonly AccessTools.FieldRef<Contract, Contract.DeadlineType> DeadlineTypeOf =
            AccessTools.FieldRefAccess<Contract, Contract.DeadlineType>("deadlineType");

        private static bool _patched;

        /// <summary>Why the hooks could not be installed, or null when they were (or have not been tried).</summary>
        public static string? PatchFailure { get; private set; }

        /// <summary>
        /// Installs the hooks once per process and binds the stock owner, so a
        /// stock change a save restores can be made again.
        /// </summary>
        public static void Install()
        {
            if (_patched)
            {
                return;
            }
            _patched = true;

            ObjectiveDelayLine.ContractViewOf = ViewOf;
            ObjectiveDelayLine.Rebind(ObjectiveDelayCapability.StockOwner, change => () => Apply(change));
            try
            {
                if (SetCompleteMethod == null || SetIncompleteMethod == null || SetFailedMethod == null || UpdateMethod == null)
                {
                    throw new MissingMethodException("a stock contract method the objective hooks patch was not found");
                }
                var harmony = new Harmony(HarmonyId);
                harmony.Patch(SetCompleteMethod, prefix: Prefix(nameof(SetCompletePrefix)));
                harmony.Patch(SetIncompleteMethod, prefix: Prefix(nameof(SetIncompletePrefix)));
                harmony.Patch(SetFailedMethod, prefix: Prefix(nameof(SetFailedPrefix)));
                harmony.Patch(UpdateMethod, prefix: Prefix(nameof(DeadlinePrefix)));
            }
            catch (Exception ex)
            {
                PatchFailure = ex.Message;
                GonogoLog.Error("installing the contract objective hooks failed; objectives reach home without signal delay", ex);
            }
        }

        private static HarmonyMethod Prefix(string name) =>
            new HarmonyMethod(typeof(StockObjectiveHooks).GetMethod(name, BindingFlags.Static | BindingFlags.NonPublic));

        private static bool SetCompletePrefix(ContractParameter __instance) => Intercept(__instance, ObjectiveState.Met);

        private static bool SetIncompletePrefix(ContractParameter __instance) => Intercept(__instance, ObjectiveState.Unmet);

        private static bool SetFailedPrefix(ContractParameter __instance) => Intercept(__instance, ObjectiveState.Failed);

        /// <summary>
        /// Skips the whole update of an active contract past its deadline while
        /// word of something a craft did before the deadline is still on its way
        /// home. Its objectives' own updates are skipped with it, and nothing
        /// after the deadline counts anyway. Once the word has arrived and not
        /// completed the contract, the next update expires it as stock does.
        /// </summary>
        private static bool DeadlinePrefix(Contract __instance)
        {
            try
            {
                if (__instance == null
                    || __instance.ContractState != Contract.State.Active
                    || DeadlineTypeOf(__instance) == Contract.DeadlineType.None
                    || Planetarium.fetch == null
                    || Planetarium.fetch.time < __instance.DateDeadline)
                {
                    return true;
                }
                return !ObjectiveDelayLine.HasHeldAtOrBefore(__instance.ContractGuid, __instance.DateDeadline);
            }
            catch (Exception ex)
            {
                GonogoLog.WarnLimited("the contract deadline hold failed (letting the deadline run)", ex);
                return true;
            }
        }

        /// <returns>True to let the game make the change now.</returns>
        private static bool Intercept(ContractParameter objective, ObjectiveState target)
        {
            if (ObjectiveDelayLine.Replaying.Active)
            {
                return true;
            }
            try
            {
                var contract = objective?.Root;
                if (objective == null || contract == null || contract.ContractState != Contract.State.Active)
                {
                    return true;
                }
                var path = PathOf(objective);
                if (path == null)
                {
                    return true;
                }
                var contractId = contract.ContractGuid;
                if (StateOf(objective.State) == target && !ObjectiveDelayLine.HasPendingFor(contractId, path))
                {
                    return true;
                }
                var craft = FlownCraftId();
                if (craft.Length == 0)
                {
                    return true;
                }

                var change = new ObjectiveChange
                {
                    ContractId = contractId,
                    OwnerId = ObjectiveDelayCapability.StockOwner,
                    ObjectivePath = path,
                    Target = target,
                    SourceVesselIds = new[] { craft },
                    CraftUt = Planetarium.GetUniversalTime(),
                    Description = objective.Title ?? "",
                };
                return !ObjectiveDelayLine.Hold(change, () => Apply(change));
            }
            catch (Exception ex)
            {
                GonogoLog.WarnLimited("holding a contract objective change failed (applying it now)", ex);
                return true;
            }
        }

        /// <summary>
        /// Makes a held change through the game's own method, found again by
        /// contract and path because a scene change rebuilds every contract.
        /// Throws when the objective can no longer be found, which drops it.
        /// </summary>
        internal static void Apply(ObjectiveChange change)
        {
            var objective = Find(FindContract(change.ContractId), change.ObjectivePath)
                ?? throw new InvalidOperationException("objective " + change.ObjectivePath + " of contract " + change.ContractId + " is gone");
            var method = change.Target switch
            {
                ObjectiveState.Met => SetCompleteMethod,
                ObjectiveState.Unmet => SetIncompleteMethod,
                _ => SetFailedMethod,
            } ?? throw new MissingMethodException("ContractParameter", change.Target.ToString());
            ObjectiveDelayLine.Replaying.RunGuarded(() => method.Invoke(objective, null));
        }

        /// <summary>Home's view of a change's contract, for the line to decide an arrival against.</summary>
        internal static ContractView ViewOf(ObjectiveChange change)
        {
            var system = ContractSystem.Instance;
            if (system == null || !ContractSystem.loaded)
            {
                return ContractView.Unreadable;
            }
            var contract = FindContract(change.ContractId);
            if (contract == null)
            {
                return new ContractView(readable: true, found: false, active: false, deadlineUt: null, objectiveFound: false, objectiveState: null);
            }
            var objective = Find(contract, change.ObjectivePath);
            return new ContractView(
                readable: true,
                found: true,
                active: contract.ContractState == Contract.State.Active,
                deadlineUt: DeadlineTypeOf(contract) == Contract.DeadlineType.None ? (double?)null : contract.DateDeadline,
                objectiveFound: objective != null,
                objectiveState: objective != null ? StateOf(objective.State) : null);
        }

        internal static Contract? FindContract(Guid contractId)
        {
            var contracts = ContractSystem.Instance?.Contracts;
            if (contracts == null)
            {
                return null;
            }
            foreach (var contract in contracts)
            {
                if (contract != null && contract.ContractGuid == contractId)
                {
                    return contract;
                }
            }
            return null;
        }

        /// <summary>The objective at <paramref name="path"/> in the contract's tree, or null.</summary>
        internal static ContractParameter? Find(Contract? contract, string path)
        {
            if (contract == null || string.IsNullOrEmpty(path))
            {
                return null;
            }
            ContractParameter? current = null;
            foreach (var step in path.Split('/'))
            {
                if (!int.TryParse(step, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var index))
                {
                    return null;
                }
                var count = current == null ? contract.ParameterCount : current.ParameterCount;
                if (index < 0 || index >= count)
                {
                    return null;
                }
                current = current == null ? contract.GetParameter(index) : current.GetParameter(index);
            }
            return current;
        }

        /// <summary>The objective's path in its contract's tree, or null when it is not attached to one.</summary>
        internal static string? PathOf(ContractParameter objective)
        {
            var path = "";
            var node = objective;
            for (var depth = 0; depth < 64; depth++)
            {
                var index = IndexInParent(node);
                if (index < 0)
                {
                    return null;
                }
                path = path.Length == 0 ? index.ToString(System.Globalization.CultureInfo.InvariantCulture) : index + "/" + path;
                if (node.Parent is ContractParameter parent)
                {
                    node = parent;
                    continue;
                }
                return node.Parent is Contract ? path : null;
            }
            return null;
        }

        private static int IndexInParent(ContractParameter objective)
        {
            switch (objective.Parent)
            {
                case Contract contract:
                    for (var i = 0; i < contract.ParameterCount; i++)
                    {
                        if (ReferenceEquals(contract.GetParameter(i), objective)) return i;
                    }
                    return -1;
                case ContractParameter parent:
                    for (var i = 0; i < parent.ParameterCount; i++)
                    {
                        if (ReferenceEquals(parent.GetParameter(i), objective)) return i;
                    }
                    return -1;
                default:
                    return -1;
            }
        }

        private static ObjectiveState? StateOf(ParameterState state) => state switch
        {
            ParameterState.Complete => ObjectiveState.Met,
            ParameterState.Incomplete => ObjectiveState.Unmet,
            ParameterState.Failed => ObjectiveState.Failed,
            _ => null,
        };

        /// <summary>The craft being flown, whose news an objective change is, or empty outside flight.</summary>
        private static string FlownCraftId()
        {
            if (!HighLogic.LoadedSceneIsFlight)
            {
                return "";
            }
            var active = ActiveVesselScope.Current;
            return active != null ? active.id.ToString() : "";
        }
    }
}
