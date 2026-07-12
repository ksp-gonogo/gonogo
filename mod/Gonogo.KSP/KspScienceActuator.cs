using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host;

namespace Gonogo.KSP
{
    /// <summary>
    /// The real <see cref="IScienceActuator"/> — the science-command actuation
    /// seam, wired to <c>ModuleScienceExperiment</c> and the stock
    /// <c>IScienceDataTransmitter</c> path (via <c>ScienceUtil.GetBestTransmitter</c>),
    /// confirmed against this KSP version's actual API shapes via decompile
    /// (see each method's own comment for the specific call). Both methods
    /// operate on <c>FlightGlobals.ActiveVessel</c> — there is no per-call
    /// vessel selector; the science read side scopes to the active vessel the
    /// same way.
    /// The experiment is addressed by the part's <c>flightID.ToString()</c>,
    /// the SAME opaque id <c>KspHost.BuildScienceInstruments</c> emits on the
    /// read side.
    ///
    /// <para>This is a KSP/Unity-touching class alongside <see cref="KspHost"/>
    /// (read side) and <see cref="KspVesselActuator"/> (vessel actuation). Like
    /// them it runs on the Unity main thread — <see cref="ChannelEngine"/> is
    /// constructed with <c>executeCommandsOnMainThread: true</c>, so every
    /// command handler is marshaled onto the main-thread pump before it reaches
    /// this actuator.</para>
    /// </summary>
    public sealed class KspScienceActuator : IScienceActuator
    {
        /// <summary>
        /// Deploys (runs) the first experiment module on the addressed part
        /// that is neither already <c>Deployed</c> nor <c>Inoperable</c> —
        /// guarded so a deploy on an already-run/spent experiment returns
        /// <see cref="CommandErrorCode.ModeUnavailable"/> rather than
        /// re-triggering. <c>ModuleScienceExperiment.DeployExperiment()</c>,
        /// <c>Deployed</c>, and <c>Inoperable</c> are decompile-confirmed public
        /// members.
        /// </summary>
        public CommandResult DeployExperiment(string partId)
        {
            if (!TryResolveExperiments(partId, out var experiments, out var error))
            {
                return CommandResult.Fail(error);
            }

            foreach (var exp in experiments)
            {
                if (exp == null)
                {
                    continue;
                }
                if (!exp.Deployed && !exp.Inoperable)
                {
                    exp.DeployExperiment();
                    return CommandResult.Ok();
                }
            }

            // Every experiment module on the part is already deployed or spent.
            return CommandResult.Fail(CommandErrorCode.ModeUnavailable);
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
        /// module inoperable when it is not rerunnable — so this side effect is
        /// faithful to the stock behaviour, not a guess.
        /// <see cref="CommandErrorCode.ModeUnavailable"/> when the part holds no
        /// data or no transmitter is available.
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
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable);
            }

            var transmitter = ScienceUtil.GetBestTransmitter(vessel);
            if (transmitter == null || !transmitter.CanTransmit())
            {
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable);
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
        /// <c>ModuleScienceExperiment</c> list on the active vessel — the same
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
