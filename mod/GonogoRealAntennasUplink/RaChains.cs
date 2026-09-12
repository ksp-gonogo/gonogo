using System;
using System.Collections.Generic;
using CommNet;
using Sitrep.Contract;

namespace Gonogo.RealAntennasUplink
{
    /// <summary>
    /// The game-touching half of antenna fallback chains: takes the chain
    /// command, walks every chain the save holds once a tick, and describes the
    /// scoped craft's chains for the wire.
    ///
    /// <para>MAIN THREAD ONLY. The walk reads a craft's comms connectivity and
    /// aims antennas, both of which are the same live-KSP reads
    /// <see cref="RaTargeting"/> already runs on main, and the chain's evaluation
    /// is registered on an UNGATED sampled source for that reason: a walk that
    /// only ran while a client was subscribed would be a fallback that worked
    /// only while someone was watching it, which is the opposite of the
    /// feature.</para>
    ///
    /// <para><b>The decision is not here.</b> When to move and where to is
    /// <see cref="RaChainPolicy"/>, which is KSP-free and tested headlessly. This
    /// class supplies the two readings it judges (has the craft a link, what time
    /// is it) and performs the aim through the ordinary targeting path, so a
    /// chained aim is refused on exactly the grounds an operator's own press
    /// would be.</para>
    ///
    /// <para><b>Every craft, not just the reported one.</b> A chain is set on an
    /// antenna and the craft carrying it keeps being flown or left alone; the walk
    /// therefore covers every vessel in the game that holds a chained antenna,
    /// not the one the client happens to be looking at. The read-back is scoped to
    /// the reported craft, which is a property of the channel rather than of the
    /// walk.</para>
    /// </summary>
    public sealed class RaChains
    {
        /// <summary>
        /// Soft cap on chained AIMS, which is the thing worth budgeting rather
        /// than the evaluation rate: evaluating costs a connectivity read per
        /// chained craft, and aiming a dish costs a network re-solve.
        ///
        /// <para>A correctly settling chain aims at most once per settle window
        /// per antenna, so a breach here means either an operator with a great
        /// many chains coming due together or a settle window that has stopped
        /// being honoured. Same reasoning, and the same shape, as the alarm arm's
        /// budget on warp stops.</para>
        /// </summary>
        private static readonly PerfBudget AimBudget = new PerfBudget(
            "RaChains chained aims", threshold: 5, windowSec: 10.0, unit: "aims");

        private readonly RaReflection _ra;
        private readonly RaTargeting _targeting;
        private readonly RaChainRegister _register;

        internal RaChains(RaReflection ra, RaTargeting targeting, RaChainRegister register)
        {
            _ra = ra;
            _targeting = targeting;
            _register = register;
        }

        /// <summary>
        /// MAIN THREAD: <c>realantennas.antenna.targetChain</c>. Stores an ordered
        /// list of targets against one antenna, replacing whatever it held.
        ///
        /// <para>Every entry is checked before ANY of them is stored, through the
        /// same planning path a single-target press goes through. A chain is
        /// accepted whole or refused whole: half a chain is a fallback with a hole
        /// in it, and the operator would not find out where until the walk got
        /// there.</para>
        ///
        /// <para>An empty list clears the chain and is always accepted, including
        /// for an antenna that has none: a clear is a statement about the end
        /// state, and refusing it would make "stop doing that" fail on the one
        /// input where it is already true.</para>
        /// </summary>
        public CommandResult SetChain(Vessel? vessel, RealAntennasTargetChainArgs? args)
        {
            if (args == null)
            {
                return CommandResult.Fail(CommandErrorCode.Range, "No arguments supplied.");
            }

            var antennaId = args.AntennaId ?? "";
            var steps = args.Steps ?? new RealAntennasTargetStepArgs[0];
            if (steps.Length == 0)
            {
                _register.Set(antennaId, steps, null);
                return CommandResult.Ok();
            }

            if (string.IsNullOrEmpty(antennaId))
            {
                return CommandResult.Fail(CommandErrorCode.Range, "No antenna was named.");
            }

            for (var i = 0; i < steps.Length; i++)
            {
                var verdict = _targeting.Plan(vessel, ArgsFor(antennaId, steps[i]));
                if (!verdict.Success)
                {
                    return CommandResult.Fail(
                        verdict.ErrorCode,
                        "Entry " + (i + 1).ToString() + " of " + steps.Length.ToString()
                            + " cannot be used, so the whole chain was refused: " + verdict.Detail);
                }
            }

            _register.Set(antennaId, steps, args.SettleSeconds);
            return CommandResult.Ok();
        }

        /// <summary>
        /// MAIN THREAD: one pass over every chain in the save, aiming at most one
        /// entry per antenna.
        ///
        /// <para>Fail-soft per chain rather than per pass: a craft whose antennas
        /// will not read must not stop the walk on every other craft's.</para>
        /// </summary>
        public void Evaluate(double nowUt)
        {
            if (_register.Count == 0)
            {
                return;
            }

            foreach (var pair in Located())
            {
                try
                {
                    Walk(pair.Key, pair.Value.Vessel, pair.Value.Antenna, nowUt);
                }
                catch (Exception ex)
                {
                    UnityEngine.Debug.LogError(
                        "[GonogoRealAntennasUplink] chain walk failed for antenna " + pair.Key + ": " + ex);
                }
            }
        }

        /// <summary>
        /// MAIN THREAD: the <c>realantennas.antennaChains</c> value for the
        /// reported craft, one entry per chained antenna it carries. Empty when it
        /// carries none, which is a real answer and not typed absence: the channel
        /// is LossyLatest, so withholding it would leave the previous craft's
        /// chains standing on the wire.
        /// </summary>
        public List<RealAntennasAntennaChain> ReadChains(Vessel? vessel, double nowUt)
        {
            var chains = new List<RealAntennasAntennaChain>();
            if (_register.Count == 0 || vessel == null)
            {
                return chains;
            }

            var antennas = _targeting.Antennas(vessel);
            var ids = _targeting.AntennaIds(antennas);
            var connected = Connected(vessel);
            var meta = new PayloadMeta
            {
                Source = "vessel:" + vessel.id,
                Quality = vessel.loaded ? Quality.Loaded : Quality.OnRails,
            };

            for (var i = 0; i < ids.Length; i++)
            {
                var entry = _register.Find(ids[i]);
                if (entry == null)
                {
                    continue;
                }

                var decision = RaChainPolicy.Decide(
                    entry.Walk, entry.Steps.Count, connected, nowUt, entry.SettleSeconds);
                var blocked = Blocker(vessel, antennas[i]);
                chains.Add(new RealAntennasAntennaChain
                {
                    AntennaId = ids[i],
                    Steps = Reported(entry.Steps),
                    ActiveStep = entry.Walk.ActiveStep,
                    // The blocker wins the state. A chain that cannot act must not
                    // report "walking" while standing still, which reads as a
                    // fallback doing its job.
                    State = blocked != null && connected != true ? RaChainPolicy.StateBlocked : decision.State,
                    Detail = blocked ?? decision.Detail,
                    SettleSeconds = entry.SettleSeconds,
                    LastAppliedUt = entry.Walk.LastAppliedUt,
                    Laps = entry.Walk.Laps,
                    Connected = connected,
                    Carrying = Carrying(vessel, antennas[i]),
                    Meta = meta,
                });
            }
            return chains;
        }

        /// <summary>One antenna's chain: aim if the policy says so, and record it if the aim landed.</summary>
        private void Walk(string antennaId, Vessel vessel, object antenna, double nowUt)
        {
            var entry = _register.Find(antennaId);
            if (entry == null)
            {
                return;
            }

            var connected = Connected(vessel);
            if (connected == true)
            {
                RaChainPolicy.NoteConnected(entry.Walk);
                return;
            }

            var decision = RaChainPolicy.Decide(
                entry.Walk, entry.Steps.Count, connected, nowUt, entry.SettleSeconds);
            if (decision.Move != RaChainPolicy.Move.Apply || Blocker(vessel, antenna) != null)
            {
                return;
            }

            var result = _targeting.Target(vessel, ArgsFor(antennaId, entry.Steps[decision.Step]));
            if (result.Success)
            {
                AimBudget.Record(1, nowUt);
            }

            // The walk moves on either way. An entry the craft refuses is an
            // entry that will not give it a link, so treating a refusal as
            // "tried and failed" is what keeps the chain reaching the ones that
            // might; stopping here would strand the craft on a target it has
            // already said no to.
            RaChainPolicy.RecordApplied(entry.Walk, decision.Step, entry.Steps.Count, nowUt);
        }

        /// <summary>
        /// The reason this antenna's chain cannot act, or null when it can.
        ///
        /// <para><b>An unloaded craft is the one real blocker.</b> An antenna
        /// reached through a proto snapshot is a rebuilt copy, not the part's own
        /// module, so aiming it changes an object the game is about to throw away
        /// and leaves the saved aim point untouched. Reporting that plainly is the
        /// honest state; aiming anyway would tell the operator their fallback had
        /// fired when nothing had moved.</para>
        /// </summary>
        private string? Blocker(Vessel vessel, object antenna)
        {
            if (_ra.ParentSnapshot(antenna) != null || !vessel.loaded)
            {
                return "This craft is not loaded, where an aim would change a rebuilt copy of the antenna and not the craft's own, so the chain is held until it is.";
            }
            if (_ra.Steerable(antenna) != true)
            {
                return "RealAntennas will not confirm this antenna can be aimed, so the chain is held rather than aiming one that may be fixed.";
            }
            return null;
        }

        /// <summary>
        /// Whether a craft has a working comms link: the whole signal the walk
        /// turns on, and CommNet's answer rather than a geometric one.
        ///
        /// <para>RealAntennas replaces the solver behind it, so on an RA install
        /// this IS RA's answer, occlusion and out-of-cone relays included, which a
        /// re-derived link budget is not: a positive margin has accompanied a link
        /// that was down. <c>null</c> when there is no connection object to ask,
        /// which the walk treats as a reason to do nothing.</para>
        /// </summary>
        private static bool? Connected(Vessel vessel)
        {
            var connection = vessel.connection;
            return connection == null ? (bool?)null : connection.IsConnected;
        }

        /// <summary>
        /// Whether this antenna is an endpoint of one of the craft's live links.
        /// Read off the control path's own transmit/receive antennas, so it is a
        /// fact about the route rather than a guess from the aim point. Null when
        /// there is no path to look at.
        /// </summary>
        private bool? Carrying(Vessel vessel, object antenna)
        {
            var path = vessel.connection?.ControlPath;
            if (path == null)
            {
                return null;
            }
            foreach (var link in path)
            {
                if (link == null)
                {
                    continue;
                }
                if (ReferenceEquals(_ra.ForwardTxAntenna(link), antenna) ||
                    ReferenceEquals(_ra.ForwardRxAntenna(link), antenna) ||
                    ReferenceEquals(_ra.ReverseTxAntenna(link), antenna) ||
                    ReferenceEquals(_ra.ReverseRxAntenna(link), antenna))
                {
                    return true;
                }
            }
            return false;
        }

        /// <summary>Where a chained antenna currently is.</summary>
        private struct Site
        {
            public Vessel Vessel;
            public object Antenna;
        }

        /// <summary>
        /// Every chained antenna the game can currently see, found in ONE pass
        /// over the vessel list rather than one pass per chain.
        ///
        /// <para>A chain whose antenna is nowhere is left alone rather than
        /// dropped: the part may be on a craft in another save, or on one that
        /// unloads and loads again, and forgetting the operator's intent because
        /// the antenna was briefly unreadable is worse than carrying a row that
        /// does nothing.</para>
        /// </summary>
        private Dictionary<string, Site> Located()
        {
            var found = new Dictionary<string, Site>();
            var vessels = FlightGlobals.Vessels;
            if (vessels == null)
            {
                return found;
            }

            foreach (var vessel in vessels)
            {
                if (vessel == null)
                {
                    continue;
                }

                IReadOnlyList<object> antennas;
                string[] ids;
                try
                {
                    antennas = _targeting.Antennas(vessel);
                    if (antennas.Count == 0)
                    {
                        continue;
                    }
                    ids = _targeting.AntennaIds(antennas);
                }
                catch (Exception)
                {
                    continue;
                }

                for (var i = 0; i < ids.Length; i++)
                {
                    if (_register.Find(ids[i]) == null || found.ContainsKey(ids[i]))
                    {
                        continue;
                    }
                    found[ids[i]] = new Site { Vessel = vessel, Antenna = antennas[i] };
                }
            }
            return found;
        }

        /// <summary>
        /// One chain entry as the single-target command's own args, which is what
        /// makes a chained aim and an operator's press the same request with the
        /// same refusals.
        /// </summary>
        /// <summary>
        /// The chain as the craft REPORTS it, which is the same targets in the
        /// same order under the read-side type. The two differ only in that the
        /// read side carries each number with its unit, and the split is the one
        /// the single-target command already makes between its args and the
        /// antenna channel beside them.
        /// </summary>
        private static RealAntennasTargetStep[] Reported(IReadOnlyList<RealAntennasTargetStepArgs> steps)
        {
            var reported = new RealAntennasTargetStep[steps.Count];
            for (var i = 0; i < steps.Count; i++)
            {
                reported[i] = new RealAntennasTargetStep
                {
                    Mode = steps[i].Mode ?? "",
                    VesselId = steps[i].VesselId,
                    BodyName = steps[i].BodyName,
                    Latitude = steps[i].Latitude,
                    Longitude = steps[i].Longitude,
                    Altitude = steps[i].Altitude,
                    Azimuth = steps[i].Azimuth,
                    Elevation = steps[i].Elevation,
                    Forward = steps[i].Forward,
                };
            }
            return reported;
        }

        private static RealAntennasTargetArgs ArgsFor(string antennaId, RealAntennasTargetStepArgs step) =>
            new RealAntennasTargetArgs
            {
                AntennaId = antennaId,
                Mode = step.Mode ?? "",
                VesselId = step.VesselId,
                BodyName = step.BodyName,
                Latitude = step.Latitude,
                Longitude = step.Longitude,
                Altitude = step.Altitude,
                Azimuth = step.Azimuth,
                Elevation = step.Elevation,
                Forward = step.Forward,
            };
    }
}
