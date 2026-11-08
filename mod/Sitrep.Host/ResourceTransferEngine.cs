using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>One tank of one resource on the active vessel, as the transfer engine sees it.</summary>
    public interface ITransferTank
    {
        double Amount { get; }
        double MaxAmount { get; }
        bool Transferable { get; }
        KspTankFlowMode FlowMode { get; }

        /// <summary>Whether this tank may take from <paramref name="source"/> under the save's crossfeed rule.</summary>
        bool CanDrawFrom(ITransferTank source);

        /// <summary>Takes up to <paramref name="amount"/> out and answers what actually left.</summary>
        double Withdraw(double amount, ITransferTank counterpart);

        /// <summary>Puts up to <paramref name="amount"/> in and answers what actually arrived.</summary>
        double Deposit(double amount, ITransferTank counterpart);

        /// <summary>Returns an amount taken by <see cref="Withdraw"/> that nothing accepted, whatever this tank's direction limit.</summary>
        void Refund(double amount);
    }

    /// <summary>Finds tanks on the active vessel. Null when the part is gone or does not carry the resource.</summary>
    public interface ITransferTanks
    {
        ITransferTank? Find(string partId, string resource);
    }

    /// <summary>
    /// Moves resources between tanks at the pace of the game's own transfer, and
    /// keeps the list <c>vessel.resourceTransfers</c> publishes. Main thread only:
    /// commands and <see cref="Step"/> both touch live tanks.
    /// </summary>
    public sealed class ResourceTransferEngine
    {
        /*
         * Stock moves dest.maxAmount / 20 per second, fixing the split between
         * sources at the press. This recomputes the split every step so the rate
         * holds as sources empty. It also debits first and refunds what the
         * destination refused, because stock debits by what it asked for and can
         * destroy fuel going into an out-only tank.
         */
        private const double FillFractionPerSecond = 1.0 / 20.0;
        private const double Epsilon = 1e-6;
        private const int EndedKept = 8;

        private readonly ITransferTanks _tanks;
        private readonly List<ResourceTransferJob> _running = new List<ResourceTransferJob>();
        private readonly List<ResourceTransferJob> _ended = new List<ResourceTransferJob>();
        private readonly HashSet<string> _issued = new HashSet<string>();
        private int _nextId = 1;
        private double? _lastStepUt;

        public ResourceTransferEngine(ITransferTanks tanks) => _tanks = tanks;

        /// <summary>Moves on every time the published list would differ.</summary>
        public long Revision { get; private set; }

        public CommandResult<ResourceTransferStarted> Start(ResourceTransferStartArgs args, double ut)
        {
            var refusal = Refusal(args);
            if (refusal != null)
            {
                return CommandResult<ResourceTransferStarted>.Fail(refusal.Value.Code, refusal.Value.Detail);
            }

            var job = new ResourceTransferJob
            {
                Id = "t" + _nextId++,
                Resource = args.Resource,
                FromPartIds = new List<string>(args.FromPartIds),
                ToPartIds = new List<string>(args.ToPartIds),
                UntilFull = args.UntilFull,
                Requested = args.UntilFull ? (double?)null : args.Amount,
                Rate = 0,
                State = TransferJobState.Running,
                StartedUt = ut,
            };
            _issued.Add(job.Id);
            if (_running.Count == 0)
            {
                _lastStepUt = ut;
            }
            _running.Add(job);
            Revision++;
            return CommandResult<ResourceTransferStarted>.Ok(new ResourceTransferStarted { TransferId = job.Id });
        }

        public CommandResult Stop(ResourceTransferStopArgs args, double ut)
        {
            if (args.All)
            {
                if (!string.IsNullOrEmpty(args.TransferId))
                {
                    return CommandResult.Fail(CommandErrorCode.Range, "name one transfer or all of them, not both");
                }

                foreach (var job in _running.ToList())
                {
                    End(job, TransferEndReason.Stopped, ut);
                }
                return CommandResult.Ok();
            }

            if (string.IsNullOrEmpty(args.TransferId))
            {
                return CommandResult.Fail(CommandErrorCode.Range, "no transfer named");
            }

            if (!_issued.Contains(args.TransferId!))
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }

            var target = _running.FirstOrDefault(j => j.Id == args.TransferId);
            if (target != null)
            {
                End(target, TransferEndReason.Stopped, ut);
            }
            return CommandResult.Ok();
        }

        /// <summary>Advances every running transfer to <paramref name="ut"/>. Elapsed game time drives it, so warp moves as much as it should.</summary>
        public void Step(double ut)
        {
            var dt = _lastStepUt is { } last ? ut - last : 0;
            _lastStepUt = ut;
            if (dt <= 0)
            {
                return;
            }

            foreach (var job in _running.ToList())
            {
                StepJob(job, dt, ut);
            }
        }

        /// <summary>Ends everything because the game left flight.</summary>
        public void EndAll(TransferEndReason reason, double ut)
        {
            foreach (var job in _running.ToList())
            {
                End(job, reason, ut);
            }
        }

        public ResourceTransfers Snapshot(string? vesselId) => new ResourceTransfers
        {
            Transfers = _running.Concat(Enumerable.Reverse(_ended)).ToList(),
            Meta = new PayloadMeta { Source = vesselId != null ? "vessel:" + vesselId : "" },
        };

        private (RefusalCode Code, string? Detail)? Refusal(ResourceTransferStartArgs args)
        {
            if (string.IsNullOrEmpty(args.Resource))
            {
                return (CommandErrorCode.Range, "no resource named");
            }
            if (args.FromPartIds.Count == 0 || args.ToPartIds.Count == 0)
            {
                return (CommandErrorCode.Range, "needs a tank to draw from and one to fill");
            }
            if (args.FromPartIds.Intersect(args.ToPartIds).Any())
            {
                return (CommandErrorCode.Range, "a tank cannot be both source and destination");
            }
            if (args.UntilFull == args.Amount.HasValue)
            {
                return (CommandErrorCode.Range, "set until full or an amount, not both");
            }
            if (args.Amount is { } amount && !(amount > 0))
            {
                return (CommandErrorCode.Range, "the amount must be above zero");
            }

            var sources = new List<ITransferTank>();
            foreach (var id in args.FromPartIds)
            {
                var tank = _tanks.Find(id, args.Resource);
                if (tank == null)
                {
                    return (CommandErrorCode.NotFound, null);
                }
                if (!tank.Transferable)
                {
                    return (CommandErrorCode.CapabilityMismatch, "this resource cannot be transferred from this tank");
                }
                if (tank.FlowMode == KspTankFlowMode.In || tank.FlowMode == KspTankFlowMode.None)
                {
                    return (CommandErrorCode.CapabilityMismatch, "a tank is set not to give");
                }
                sources.Add(tank);
            }

            var destinations = new List<ITransferTank>();
            foreach (var id in args.ToPartIds)
            {
                var tank = _tanks.Find(id, args.Resource);
                if (tank == null)
                {
                    return (CommandErrorCode.NotFound, null);
                }
                if (!tank.Transferable)
                {
                    return (CommandErrorCode.CapabilityMismatch, "this resource cannot be transferred into this tank");
                }
                if (tank.FlowMode == KspTankFlowMode.Out || tank.FlowMode == KspTankFlowMode.None)
                {
                    return (CommandErrorCode.CapabilityMismatch, "a tank is set not to take");
                }
                if (sources.Any(s => !tank.CanDrawFrom(s)))
                {
                    return (CommandErrorCode.CapabilityMismatch, "not connected by crossfeed");
                }
                destinations.Add(tank);
            }

            var named = new HashSet<string>(args.FromPartIds.Concat(args.ToPartIds));
            if (_running.Any(j => j.Resource == args.Resource && j.FromPartIds.Concat(j.ToPartIds).Any(named.Contains)))
            {
                return (CommandErrorCode.WrongState, "a tank is already in a transfer of this resource");
            }
            if (sources.All(s => s.Amount <= Epsilon))
            {
                return (CommandErrorCode.WrongState, "nothing to move");
            }
            if (destinations.All(d => d.MaxAmount - d.Amount <= Epsilon))
            {
                return (CommandErrorCode.WrongState, "no room to fill");
            }
            return null;
        }

        private void StepJob(ResourceTransferJob job, double dt, double ut)
        {
            var sources = job.FromPartIds.Select(id => _tanks.Find(id, job.Resource)).Where(t => t != null).Select(t => t!).ToList();
            var destinations = job.ToPartIds.Select(id => _tanks.Find(id, job.Resource)).Where(t => t != null).Select(t => t!).ToList();

            if (sources.Count == 0 && destinations.Count == 0)
            {
                End(job, TransferEndReason.VesselLeft, ut);
                return;
            }
            if (sources.Count == 0 || destinations.Count == 0)
            {
                End(job, TransferEndReason.PartsLeft, ut);
                return;
            }

            var movedThisStep = 0.0;
            foreach (var destination in destinations)
            {
                var want = Math.Min(destination.MaxAmount * FillFractionPerSecond * dt, destination.MaxAmount - destination.Amount);
                if (job.Requested is { } requested)
                {
                    want = Math.Min(want, requested - job.Moved - movedThisStep);
                }
                if (want <= 0)
                {
                    continue;
                }

                var holding = sources.Where(s => s.Amount > Epsilon).ToList();
                foreach (var source in holding)
                {
                    var given = source.Withdraw(want / holding.Count, destination);
                    var taken = destination.Deposit(given, source);
                    if (given - taken > 0)
                    {
                        source.Refund(given - taken);
                    }
                    movedThisStep += taken;
                }
            }

            job.Moved += movedThisStep;
            job.Rate = movedThisStep / dt;
            Revision++;

            if (job.Requested is { } target && job.Moved >= target - Epsilon)
            {
                End(job, TransferEndReason.AmountMoved, ut);
                return;
            }
            if (destinations.All(d => d.MaxAmount - d.Amount <= Epsilon))
            {
                End(job, TransferEndReason.DestinationsFull, ut);
                return;
            }
            if (sources.All(s => s.Amount <= Epsilon))
            {
                End(job, TransferEndReason.SourcesEmpty, ut);
            }
        }

        private void End(ResourceTransferJob job, TransferEndReason reason, double ut)
        {
            _running.Remove(job);
            job.State = TransferJobState.Ended;
            job.EndReason = reason;
            job.EndedUt = ut;
            job.Rate = null;
            _ended.Add(job);
            if (_ended.Count > EndedKept)
            {
                _ended.RemoveAt(0);
            }
            Revision++;
        }
    }

    /// <summary>Flattens the transfer Topics for the wire.</summary>
    public static class ResourceTransferWire
    {
        public const string TransfersTopic = "vessel.resourceTransfers";
        public const string ReachTopic = "vessel.transferReach";
        public const string StartCommand = "vessel.resource.transfer.start";
        public const string StopCommand = "vessel.resource.transfer.stop";

        public static Dictionary<string, object?> ToWire(ResourceTransfers payload) => new Dictionary<string, object?>
        {
            ["transfers"] = payload.Transfers.Select(j => (object?)ToWire(j)).ToList(),
            ["meta"] = new Dictionary<string, object?> { ["source"] = payload.Meta.Source },
        };

        public static Dictionary<string, object?> ToWire(TransferReach payload) => new Dictionary<string, object?>
        {
            ["obeysCrossfeed"] = payload.ObeysCrossfeed,
            ["sets"] = payload.Sets.Select(s => (object?)ToWire(s)).ToList(),
            ["resources"] = payload.Resources.ToDictionary(
                kvp => kvp.Key,
                kvp => (object?)kvp.Value.Select(t => (object?)ToWire(t)).ToList()),
            ["meta"] = new Dictionary<string, object?> { ["source"] = payload.Meta.Source },
        };

        private static Dictionary<string, object?> ToWire(ResourceTransferJob j) => new Dictionary<string, object?>
        {
            ["id"] = j.Id,
            ["resource"] = j.Resource,
            ["fromPartIds"] = j.FromPartIds.ToList<object?>(),
            ["toPartIds"] = j.ToPartIds.ToList<object?>(),
            ["untilFull"] = j.UntilFull,
            ["requested"] = j.Requested,
            ["moved"] = j.Moved,
            ["rate"] = j.Rate,
            ["state"] = (int)j.State,
            ["endReason"] = j.EndReason is { } reason ? (int)reason : (int?)null,
            ["startedUt"] = j.StartedUt,
            ["endedUt"] = j.EndedUt,
        };

        private static Dictionary<string, object?> ToWire(CrossfeedSet s) => new Dictionary<string, object?>
        {
            ["id"] = s.Id,
            ["partIds"] = s.PartIds.ToList<object?>(),
        };

        private static Dictionary<string, object?> ToWire(TankReach t) => new Dictionary<string, object?>
        {
            ["partId"] = t.PartId,
            ["drawsFromSet"] = t.DrawsFromSet,
        };
    }
}
