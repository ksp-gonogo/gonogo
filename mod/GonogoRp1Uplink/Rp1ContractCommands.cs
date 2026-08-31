// The payload mass RP-1's repeating satellite contracts require, set once instead
// of ninety-six times.
//
// WHAT RP-1 DOES, and it is the reason this command exists rather than a slider.
// ContractGUI.RenderContractsTab draws two sliders and runs EVERY DRAW FRAME. Each
// frame it reads the slider back, compares it against the stored setting, fires the
// withdrawal for every matching contract name, and only THEN writes the setting.
// So the comparison is against the PREVIOUS frame's value, and a drag from 400 to
// 10,000 crosses ninety-six hundred-unit steps and fires the withdrawal at every
// one of them. Nothing on the tab says so.
//
// WHAT THE WITHDRAWAL ACTUALLY REACHES, stated precisely because the frightening
// version is wrong and an operator deserves the true one. WithdrawContractAction is
// a static Func<string, bool> on ContractGUI that RP0.dll only ever READS: it is
// assigned by CC_RP0.dll, in
// ContractConfigurator.RP0.CustomExpressionParserRegistrer.RegisterRP0Hooks, and
// its implementation walks ContractPreLoader.Instance.PendingContracts() and
// withdraws the FIRST match, then returns. So it reaches PRE-GENERATED OFFERS and
// never an accepted contract, and it takes one per name per call. A drag churns the
// offer pool so offers regenerate against the new requirement, which is the intent
// of the feature fired far too often. It is WASTE, not loss.
//
// THE STATE RP-1 CANNOT TELL THE PLAYER, and the most valuable thing this command
// returns. On an install without CC_RP0 the delegate is NULL, RP-1's `?.Invoke`
// does nothing, and the payload requirement changes while every pending offer keeps
// the OLD one. RP-1's tab reports that exactly as it reports success: silently. This
// command says whether the hook was there and how many offers actually went.
//
// WHAT IS READ RATHER THAN WRITTEN DOWN. The bounds and the contract names are
// RP-1's own:
//
//   ContractGUI.MinPayload / MaxPayload
//                              the range its sliders span. Read rather than
//                              hard-coded so a retune moves our refusal with it
//   ContractGUI._comSatContracts / _weatherSatContracts
//                              PRIVATE static string arrays naming which contract
//                              types each figure invalidates: three comsat types
//                              and one weather. Read rather than copied, so an
//                              RP-1 release that adds a fourth comsat type has its
//                              offers withdrawn too without this file being told
//
// WHAT IS WRITTEN, and it is TWO places for one value:
//
//   ContractGUI.CommsPayload / WeatherPayload
//                              the live statics, which is what
//                              ContractConfigurator's RP1CommsPayload expression
//                              function reads when it generates a contract
//   RP0Settings.CommsPayload / WeatherPayload
//                              the PERSISTED halves, reached through KSP's
//                              GameParameters. Writing only the statics would let
//                              the figure revert on load; writing only the settings
//                              would leave the next generated contract on the old
//                              requirement. RP-1 writes both and so must this
//
// KSP's SETTINGS ACCESSOR HAS TWO OVERLOADS AND ONLY ONE IS SAFE.
// GameParameters declares `T CustomParams<T>()` (generic, arity 0) beside
// `CustomParameterNode CustomParams(Type)` (arity 1). This uses the NON-GENERIC
// one, matched on its first parameter's type, for two reasons: reflection would
// need MakeGenericMethod for the other, and the generic one THROWS an
// ArgumentException when the node is not registered where the non-generic returns.
// A refusal beats an exception crossing the Uplink boundary.
//
// The decompilation of both is obfuscator-mangled (unreachable switch arms,
// `if (1 == 0)`, LdMemberToken artefacts), so NOTHING here relies on their bodies:
// only on the signatures, which are not obfuscated, and on treating a null return
// as "not registered". That is the discipline this repo already learned the hard
// way about reading KSP's own assembly.
//
// PROVENANCE. RP-1's members were read out of an ilspycmd disassembly of the
// INSTALLED RP-1 v4.6.0.0 RP0.dll; the withdrawal's implementation out of the
// INSTALLED CC_RP0.dll beside it; and KSP's accessor signatures out of the
// installed Assembly-CSharp.dll. Shape is verified and value is not: nothing here
// has been exercised against a running game, so every hop is null-safe and every
// failure to read refuses the command rather than guessing at it.
using System;
using System.Collections.Generic;
using System.Globalization;
using Sitrep.Contract;

namespace GonogoRp1Uplink
{
    /// <summary>The handler for <c>rp1.contracts.setPayload</c>.</summary>
    public sealed class Rp1ContractCommands
    {
        /// <summary>Set the payload mass RP-1's repeating satellite contracts require.</summary>
        public const string SetPayloadCommand = "rp1.contracts.setPayload";

        /// <summary>The step RP-1's own control rounds to, so a figure between steps is not a figure it can hold.</summary>
        public const int PayloadStep = 100;

        private const string ContractGuiTypeName = "RP0.ContractGUI";
        private const string SettingsTypeName = "RP0.RP0Settings";
        private const string HighLogicTypeName = "HighLogic";

        private readonly Type? _contractGui;
        private readonly Type? _settings;
        private readonly Type? _highLogic;

        public Rp1ContractCommands()
        {
            _contractGui = Rp1Types.Find(ContractGuiTypeName);
            _settings = Rp1Types.Find(SettingsTypeName);
            _highLogic = Rp1Types.Find(HighLogicTypeName);
        }

        /// <summary>
        /// The command can run: RP-1's contract tab, its settings node and KSP's
        /// game state all resolved.
        ///
        /// <para>TYPES ONLY, for the reason
        /// <see cref="Rp1VehicleCommands.IsAvailable"/> spells out at length.
        /// <see cref="_highLogic"/> IS part of it here, unlike the warp commands:
        /// there the scene was a courtesy that could fail open, and here it is the
        /// only route to the persisted half of the value. A command that could write
        /// the live figure and not the saved one would look like it worked and
        /// revert on load.</para>
        /// </summary>
        public bool IsAvailable => _contractGui != null && _settings != null && _highLogic != null;

        /// <summary>
        /// Whether the members this command reaches resolved, as a sentence for a
        /// health fact.
        ///
        /// <para>Names the WITHDRAWAL separately from everything else, because it is
        /// the one whose absence is invisible in the result: without it the payload
        /// still changes and every pending offer silently keeps the old
        /// requirement.</para>
        /// </summary>
        public string MethodDiagnosis()
        {
            if (!IsAvailable)
            {
                return "RP-1 contract types not found";
            }

            var missing = new List<string>();
            try
            {
                if (Rp1Types.StaticValue(_contractGui!, "MinPayload") == null
                    || Rp1Types.StaticValue(_contractGui!, "MaxPayload") == null)
                {
                    missing.Add("ContractGUI.MinPayload/MaxPayload");
                }
                if (ContractNames("_comSatContracts").Count == 0
                    && ContractNames("_weatherSatContracts").Count == 0)
                {
                    missing.Add("ContractGUI's contract-name lists");
                }
                if (Rp1Types.StaticValue(_contractGui!, "WithdrawContractAction") == null)
                {
                    // NOT listed as missing: this delegate is supplied by CC_RP0 and
                    // is legitimately null before ContractConfigurator has run its
                    // registration, and on an install without it. Reported as the
                    // fact it is, because it changes what the command can promise.
                    return "registered, but ContractConfigurator's withdrawal hook is absent, "
                        + "so a payload change will not invalidate pending offers";
                }
            }
            catch (Exception ex)
            {
                // Runs from Health, on the Courier thread. A diagnostic that takes
                // the health surface down with it is worse than no diagnostic.
                return "payload changes will refuse at the press: member lookup threw: "
                    + Rp1Types.ExceptionReason(ex);
            }

            return missing.Count == 0
                ? "every invoked member resolved"
                : "payload changes will refuse at the press: " + string.Join(", ", missing.ToArray())
                  + " not found";
        }

        /// <summary>
        /// Sets one or both payload requirements, and invalidates the pending offers
        /// each one affects EXACTLY ONCE.
        /// </summary>
        public CommandResult<Dictionary<string, object?>> SetPayload(Rp1ContractPayloadArgs? args)
        {
            if (!IsAvailable)
            {
                return Refuse(CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1's contract settings could not be resolved, so nothing was changed"));
            }

            var comms = args?.CommsPayload;
            var weather = args?.WeatherPayload;
            if (comms == null && weather == null)
            {
                return Refuse(CommandResult.Fail(
                    CommandErrorCode.Range,
                    "the command named neither payload requirement, so there was nothing to set"));
            }

            var min = Rp1Types.ToDouble(Rp1Types.StaticValue(_contractGui!, "MinPayload"));
            var max = Rp1Types.ToDouble(Rp1Types.StaticValue(_contractGui!, "MaxPayload"));
            if (min == null || max == null)
            {
                // Refused rather than bounded by figures of our own: RP-1's range is
                // a balance decision and a command that invented one would let an
                // operator require a payload the contract generator cannot serve.
                return Refuse(CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 would not say what payload range its contracts accept, so nothing was changed"));
            }

            if (!Within(comms, min.Value, max.Value, "CommSat", out var commsRefusal))
            {
                return Refuse(commsRefusal!);
            }
            if (!Within(weather, min.Value, max.Value, "WeatherSat", out var weatherRefusal))
            {
                return Refuse(weatherRefusal!);
            }

            var persisted = PersistedSettings();
            if (persisted == null)
            {
                return Refuse(CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1's settings are not loaded for this save, so a payload change would not persist"));
            }

            // Read BEFORE writing, so a figure already set can be reported as
            // unchanged rather than withdrawing offers for nothing. That is the
            // whole difference between this and RP-1's own tab.
            var commsNow = ReadInt(_contractGui!, "CommsPayload");
            var weatherNow = ReadInt(_contractGui!, "WeatherPayload");

            var commsChanged = comms != null && comms.Value != commsNow;
            var weatherChanged = weather != null && weather.Value != weatherNow;

            if (!commsChanged && !weatherChanged)
            {
                // Succeeds, because the asked-for state IS the state, and withdraws
                // nothing. RP-1's own tab would fire no withdrawal here either, and
                // this is the one case where the two agree.
                return Ok(commsNow, weatherNow, withdrawn: 0, hookPresent: WithdrawalHook() != null, changed: false);
            }

            if (commsChanged && !Write("CommsPayload", comms!.Value, persisted, out var commsWriteRefusal))
            {
                return Refuse(commsWriteRefusal!);
            }
            if (weatherChanged && !Write("WeatherPayload", weather!.Value, persisted, out var weatherWriteRefusal))
            {
                return Refuse(weatherWriteRefusal!);
            }

            // ONCE per affected contract name, which is the point of the command.
            var hook = WithdrawalHook();
            var withdrawn = 0;
            if (hook != null)
            {
                if (commsChanged)
                {
                    withdrawn += WithdrawAll(hook, ContractNames("_comSatContracts"));
                }
                if (weatherChanged)
                {
                    withdrawn += WithdrawAll(hook, ContractNames("_weatherSatContracts"));
                }
            }

            return Ok(
                commsChanged ? comms!.Value : commsNow,
                weatherChanged ? weather!.Value : weatherNow,
                withdrawn,
                hookPresent: hook != null,
                changed: true);
        }

        // ── Validation ────────────────────────────────────────────────────────

        /// <summary>
        /// Whether a figure is one RP-1's own control could have produced: inside
        /// its range and on its step.
        /// </summary>
        /// <remarks>
        /// REFUSED rather than clamped or rounded, both of which would report
        /// success for a requirement the operator did not choose. The step matters
        /// as much as the range: RP-1 rounds its slider to hundreds, so a figure
        /// between steps is not one the game can hold and would drift the moment
        /// anybody opened the tab.
        /// </remarks>
        private static bool Within(int? value, double min, double max, string which, out CommandResult? refusal)
        {
            refusal = null;
            if (value == null)
            {
                return true;
            }

            if (value.Value < min || value.Value > max)
            {
                refusal = CommandResult.Fail(
                    CommandErrorCode.Range,
                    which + " payload must be between " + Number(min) + " and " + Number(max)
                    + " kg, and the command asked for " + Number(value.Value));
                return false;
            }

            if (value.Value % PayloadStep != 0)
            {
                refusal = CommandResult.Fail(
                    CommandErrorCode.Range,
                    which + " payload moves in steps of " + PayloadStep
                    + " kg, and " + Number(value.Value) + " is between two of them");
                return false;
            }

            return true;
        }

        // ── The two places one value lives ────────────────────────────────────

        /// <summary>
        /// Writes a payload figure to BOTH the live static and the persisted
        /// setting, refusing if either will not take it.
        /// </summary>
        /// <remarks>
        /// Both or neither, as far as one non-transactional write can manage: the
        /// live static is what the contract generator reads and the persisted field
        /// is what survives a load, so a half-write is a figure that works until
        /// the save is reopened or works only until the next contract generates.
        /// Refused with the half named, so an operator knows which they have.
        /// </remarks>
        private bool Write(string member, int value, object persisted, out CommandResult? refusal)
        {
            if (!Rp1Types.WriteStatic(_contractGui, member, value))
            {
                refusal = CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 would not accept a new " + member + ", so nothing was changed");
                return false;
            }

            if (!Rp1Types.WriteMember(persisted, member, value))
            {
                refusal = CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 took the new " + member + " for this session and would not persist it, "
                    + "so it will revert when the save is reloaded");
                return false;
            }

            refusal = null;
            return true;
        }

        /// <summary>
        /// RP-1's own persisted settings node for this save.
        /// </summary>
        /// <remarks>
        /// Through KSP's NON-GENERIC <c>CustomParams(Type)</c>, matched on its first
        /// parameter's type. The generic <c>CustomParams&lt;T&gt;()</c> beside it
        /// would need <c>MakeGenericMethod</c> and THROWS when the node is not
        /// registered, where this one returns and lets the command refuse.
        /// </remarks>
        private object? PersistedSettings()
        {
            var game = Rp1Types.StaticValue(_highLogic!, "CurrentGame");
            var parameters = Rp1Types.Member(game, "Parameters");
            if (parameters == null)
            {
                return null;
            }

            var accessor = Rp1Types.InstanceMethodOn(parameters, "CustomParams", "System.Type", 1);
            if (accessor == null)
            {
                return null;
            }

            try
            {
                return accessor.Invoke(parameters, new object[] { _settings! });
            }
            catch (Exception)
            {
                // A node KSP has not registered is a refusal rather than a crash,
                // which is the whole reason the non-generic overload is the one used.
                return null;
            }
        }

        // ── The withdrawal ────────────────────────────────────────────────────

        /// <summary>
        /// ContractConfigurator's withdrawal delegate, or absent.
        /// </summary>
        /// <remarks>
        /// Absent is a REAL and reportable state rather than a fault: RP0.dll only
        /// reads this field, CC_RP0.dll assigns it, and on an install without
        /// ContractConfigurator's RP-0 half it stays null. RP-1's own tab treats that
        /// exactly as it treats success.
        /// </remarks>
        private object? WithdrawalHook() =>
            Rp1Types.StaticValue(_contractGui!, "WithdrawContractAction");

        /// <summary>
        /// Withdraws the first pending offer of each named contract type, once per
        /// name, and counts how many actually went.
        /// </summary>
        /// <remarks>
        /// The count is the honest half of the result. RP-1's hook returns false when
        /// there was no pending offer of that type and when the pre-loader is not
        /// running at all, so a zero here means "nothing needed invalidating" rather
        /// than "it failed", and an operator reading it beside
        /// <c>withdrawalAvailable</c> can tell those apart.
        /// </remarks>
        private static int WithdrawAll(object hook, IReadOnlyCollection<string> names)
        {
            var invoke = Rp1Types.InstanceMethod(hook, "Invoke", 1);
            if (invoke == null)
            {
                return 0;
            }

            var withdrawn = 0;
            foreach (var name in names)
            {
                try
                {
                    if (invoke.Invoke(hook, new object[] { name }) as bool? == true)
                    {
                        withdrawn++;
                    }
                }
                catch (Exception)
                {
                    // One contract type that will not withdraw must not stop the
                    // rest: the figure is already written, and leaving the other
                    // types' offers stale would be worse than a partial pass.
                }
            }
            return withdrawn;
        }

        /// <summary>
        /// Which contract types a payload figure invalidates, off RP-1's own private
        /// lists.
        /// </summary>
        /// <remarks>
        /// Read rather than copied, and that is the point: RP-1 names three comsat
        /// types and one weather type today, and a release that adds a fourth has its
        /// offers withdrawn too without this file being told about it. A table
        /// written down here would go stale silently, which is the failure this whole
        /// Uplink is shaped to avoid.
        /// </remarks>
        private IReadOnlyList<string> ContractNames(string member)
        {
            var names = new List<string>();
            foreach (var entry in Rp1Types.Enumerate(Rp1Types.StaticValue(_contractGui!, member)))
            {
                if (entry is string name && !string.IsNullOrWhiteSpace(name))
                {
                    names.Add(name);
                }
            }
            return names;
        }

        // ── Oddments ──────────────────────────────────────────────────────────

        private static int? ReadInt(Type type, string member) =>
            Rp1Types.StaticValue(type, member) switch
            {
                int i => i,
                long l => (int)l,
                _ => null,
            };

        private static CommandResult<Dictionary<string, object?>> Ok(
            int? comms,
            int? weather,
            int withdrawn,
            bool hookPresent,
            bool changed) =>
            CommandResult<Dictionary<string, object?>>.Ok(new Dictionary<string, object?>
            {
                ["commsPayload"] = comms,
                ["weatherPayload"] = weather,
                // How many pending offers actually went, which RP-1 reports nowhere.
                ["offersWithdrawn"] = withdrawn,
                // And whether it COULD have withdrawn any. Without the hook the
                // requirement changes and every pending offer keeps the old one,
                // which RP-1 reports exactly as it reports success.
                ["withdrawalAvailable"] = hookPresent,
                // False when the figures were already what was asked for, so a
                // re-sent command is visibly a no-op rather than looking like a
                // second round of churn.
                ["changed"] = changed,
            });

        private static CommandResult<Dictionary<string, object?>> Refuse(CommandResult refusal) =>
            CommandResult<Dictionary<string, object?>>.Fail(refusal.ErrorCode, refusal.Detail);

        /// <summary>Grouped, because these are read by a person: 10,000 rather than 10000.</summary>
        private static string Number(double value) =>
            value.ToString("N0", CultureInfo.InvariantCulture);
    }
}
