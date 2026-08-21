using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host;

namespace Gonogo.KSP
{
    /// <summary>
    /// The real <see cref="IScienceActuator"/>: the science-command actuation
    /// seam, wired to <c>ModuleScienceExperiment</c> and the stock
    /// <c>IScienceDataTransmitter</c> path (via <c>ScienceUtil.GetBestTransmitter</c>),
    /// confirmed against this KSP version's actual API shapes via decompile
    /// (see each method's own comment for the specific call). Both methods
    /// operate on <c>FlightGlobals.ActiveVessel</c>: there is no per-call
    /// vessel selector; the science read side scopes to the active vessel the
    /// same way.
    /// The experiment is addressed by the part's <c>flightID.ToString()</c>,
    /// the SAME opaque id <c>KspHost.BuildScienceInstruments</c> emits on the
    /// read side.
    ///
    /// <para>This is a KSP/Unity-touching class alongside <see cref="KspHost"/>
    /// (read side) and <see cref="KspVesselActuator"/> (vessel actuation). Like
    /// them it runs on the Unity main thread, <see cref="ChannelEngine"/> is
    /// constructed with <c>executeCommandsOnMainThread: true</c>, so every
    /// command handler is marshaled onto the main-thread pump before it reaches
    /// this actuator.</para>
    /// </summary>
    public sealed class KspScienceActuator : IScienceActuator
    {
        /// <summary>
        /// Deploys (runs) the first experiment module on the addressed part
        /// that is neither already <c>Deployed</c> nor <c>Inoperable</c> AND
        /// that the game would actually run.
        ///
        /// <para><b>Three refusals used to come back green.</b>
        /// <c>ModuleScienceExperiment.DeployExperiment()</c> returns
        /// <c>void</c> and refuses through <c>ScreenMessages</c>: shielded from
        /// the airstream, an unmet <c>ExperimentUsageReqs</c>, or a live
        /// cooldown. Calling it and returning <c>Ok()</c> reported a run that
        /// never happened, and the message the player would have seen is on the
        /// KSP window rather than the console. All three are asked first now,
        /// through <see cref="ExperimentDeployRule"/>, in stock's order.</para>
        ///
        /// <para>The walk continues past a refused module rather than stopping
        /// at it. Refusing the WHOLE part because its first module is shielded,
        /// when a second module on the same part would have run, was the same
        /// bug in the other direction: it returned Ok having deployed
        /// nothing.</para>
        /// </summary>
        public CommandResult DeployExperiment(string partId)
        {
            if (!TryResolveExperiments(partId, out var experiments, out var error))
            {
                return CommandResult.Fail(error);
            }

            var anyInoperable = false;
            ExperimentRefusal? firstRefusal = null;
            foreach (var exp in experiments)
            {
                if (exp == null)
                {
                    continue;
                }
                if (!exp.Deployed && !exp.Inoperable)
                {
                    var refusal = DeployRefusal(exp);
                    if (refusal == null)
                    {
                        exp.DeployExperiment();
                        return CommandResult.Ok();
                    }
                    firstRefusal ??= refusal;
                    continue;
                }
                anyInoperable |= exp.Inoperable;
            }

            if (firstRefusal != null)
            {
                return CommandResult.Fail(firstRefusal.Value.Code, firstRefusal.Value.Detail);
            }

            // Every experiment module on the part is already deployed or spent.
            // Which of the two matters: a deployed experiment still holds its
            // data and an inoperable one needs a scientist to reset it.
            return CommandResult.Fail(
                CommandErrorCode.WrongState,
                anyInoperable
                    ? "the experiment is spent and needs resetting"
                    : "the experiment has already been run");
        }

        /// <summary>
        /// Reads the three facts <see cref="ExperimentDeployRule"/> decides on
        /// off one live module, exactly as
        /// <c>ModuleScienceExperiment.DeployExperiment</c> reads them.
        ///
        /// <para><c>usageReqMessage</c> is a public field the game writes into,
        /// so that arm's sentence needs no table of ours. The other two live in
        /// KSP's localisation table under opaque <c>#autoLOC_</c> numbers and
        /// are formatted here: a number the game renumbers would otherwise put a
        /// confidently wrong sentence in front of an operator, so
        /// <c>GameWords.Sentence</c> checks the Localizer actually resolved it
        /// and falls back rather than printing the key.</para>
        /// </summary>
        private static ExperimentRefusal? DeployRefusal(ModuleScienceExperiment exp)
        {
            try
            {
                var shielded = !exp.availableShielded && exp.part != null && exp.part.ShieldedFromAirstream;

                var usageMet = true;
                if (!shielded && exp.experiment != null && exp.part != null && exp.vessel != null)
                {
                    usageMet = ScienceUtil.RequiredUsageInternalAvailable(
                        exp.vessel,
                        exp.part,
                        (ExperimentUsageReqs)exp.usageReqMaskInternal,
                        exp.experiment,
                        ref exp.usageReqMessage);
                }

                return ExperimentDeployRule.RefusalFor(
                    shielded,
                    usageMet,
                    exp.usageReqMessage ?? "",
                    exp.useCooldown && exp.cooldownTimer > 0.0,
                    GameWords.Sentence("#autoLOC_238290", "the part is shielded from the airstream"),
                    GameWords.Sentence(
                        "#autoLOC_238298",
                        "the experiment is still cooling down",
                        KSPUtil.PrintTimeCompact(exp.cooldownToGo, explicitPositive: false)));
            }
            catch (Exception)
            {
                // A precheck that cannot be read must not report the deploy as
                // refused OR as run. Falling through to the deploy is the same
                // behaviour as before this gate existed, and the game still has
                // its own three arms behind it.
                return null;
            }
        }

        /// <summary>
        /// Transmits the stored data of the first experiment module on the
        /// addressed part that actually holds data, reproducing the stock
        /// transmit flow (<c>ModuleScienceExperiment.sendDataToComms</c>,
        /// decompile-confirmed): resolve the best transmitter via
        /// <c>ScienceUtil.GetBestTransmitter(vessel)</c> (which already honours
        /// CommNet and only returns a transmitter that <c>CanTransmit()</c>),
        /// hand it the module's <c>GetData()</c> as a
        /// <c>List&lt;ScienceData&gt;</c> through
        /// <c>IScienceDataTransmitter.TransmitData</c>, then dump each
        /// transmitted result off the module. <c>DumpData</c> is the public
        /// entry point to the same private <c>endExperiment</c>/<c>dumpData</c>
        /// path stock's transmit uses: it clears the stored data and sets the
        /// module inoperable when it is not rerunnable, so this side effect is
        /// faithful to the stock behaviour, not a guess.
        /// <see cref="CommandErrorCode.WrongState"/> when the part holds no data,
        /// <see cref="CommandErrorCode.NoConnection"/> when no transmitter on the
        /// craft can carry it.
        /// </summary>
        public CommandResult TransmitExperiment(string partId)
        {
            var vessel = FlightGlobals.ActiveVessel;
            if (vessel == null)
            {
                return CommandResult.Fail(CommandErrorCode.NoVessel);
            }

            if (!TryResolveExperiments(partId, out var experiments, out var error))
            {
                return CommandResult.Fail(error);
            }

            ModuleScienceExperiment? withData = null;
            ScienceData[]? data = null;
            foreach (var exp in experiments)
            {
                if (exp == null)
                {
                    continue;
                }
                var stored = exp.GetData();
                if (stored != null && stored.Length > 0)
                {
                    withData = exp;
                    data = stored;
                    break;
                }
            }

            if (withData == null || data == null)
            {
                return CommandResult.Fail(
                    CommandErrorCode.WrongState, "no experiment on this part is holding data");
            }

            // GetBestTransmitter already honours CommNet and only returns one
            // that CanTransmit, so a null here and a busy one are the same fact
            // from the vessel's side: nothing aboard can carry the payload.
            var transmitter = ScienceUtil.GetBestTransmitter(vessel);
            if (transmitter == null || !transmitter.CanTransmit())
            {
                return CommandResult.Fail(
                    CommandErrorCode.NoConnection,
                    transmitter == null
                        ? "no usable comms device aboard"
                        : "the antenna cannot transmit right now");
            }

            transmitter.TransmitData(new List<ScienceData>(data));

            foreach (var stored in data)
            {
                withData.DumpData(stored);
            }

            return CommandResult.Ok();
        }

        /// <summary>
        /// Resolves the opaque <paramref name="partId"/> (a part's
        /// <c>flightID.ToString()</c>) to that part's live
        /// <c>ModuleScienceExperiment</c> list on the active vessel: the same
        /// join key <c>KspHost.BuildScienceInstruments</c> emits. Returns
        /// <see cref="CommandErrorCode.NoVessel"/> with no active vessel,
        /// <see cref="CommandErrorCode.NotFound"/> when no part carries the id
        /// or the resolved part has no experiment module at all.
        /// </summary>
        private static bool TryResolveExperiments(string partId, out List<ModuleScienceExperiment> experiments, out CommandErrorCode error)
        {
            experiments = new List<ModuleScienceExperiment>();

            var vessel = FlightGlobals.ActiveVessel;
            if (vessel == null || vessel.parts == null)
            {
                error = CommandErrorCode.NoVessel;
                return false;
            }

            Part? found = null;
            foreach (var part in vessel.parts)
            {
                if (part == null)
                {
                    continue;
                }
                // flightID is the same stable per-Part join key the read side
                // uses (see KspHost.BuildScienceInstruments); 0 is the
                // uninitialized sentinel, so it never matches a real id.
                if (part.flightID != 0 && string.Equals(part.flightID.ToString(), partId, StringComparison.Ordinal))
                {
                    found = part;
                    break;
                }
            }

            if (found == null || found.Modules == null)
            {
                error = CommandErrorCode.NotFound;
                return false;
            }

            var modules = found.Modules.GetModules<ModuleScienceExperiment>();
            if (modules == null || modules.Count == 0)
            {
                error = CommandErrorCode.NotFound;
                return false;
            }

            experiments = modules;
            error = CommandErrorCode.None;
            return true;
        }
    }
}
