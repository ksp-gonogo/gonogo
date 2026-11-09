using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    public class ResourceTransferEngineTests
    {
        private sealed class Tank : ITransferTank
        {
            public double Amount { get; set; }
            public double MaxAmount { get; set; }
            public bool Transferable { get; set; } = true;
            public KspTankFlowMode FlowMode { get; set; } = KspTankFlowMode.Both;
            public bool Reachable { get; set; } = true;
            public double DepositCap { get; set; } = double.MaxValue;

            public bool CanDrawFrom(ITransferTank source) => Reachable;

            public double Withdraw(double amount, ITransferTank counterpart)
            {
                var given = System.Math.Min(amount, Amount);
                Amount -= given;
                return given;
            }

            public void Refund(double amount) => Amount += amount;

            public double Deposit(double amount, ITransferTank counterpart)
            {
                var taken = System.Math.Min(System.Math.Min(amount, MaxAmount - Amount), DepositCap);
                Amount += taken;
                return taken;
            }
        }

        private sealed class Tanks : ITransferTanks
        {
            public readonly Dictionary<string, Tank> ById = new Dictionary<string, Tank>();
            public ITransferTank? Find(string partId, string resource) => ById.TryGetValue(partId, out var t) ? t : null;
        }

        private static (ResourceTransferEngine, Tanks) Rig(params (string Id, double Amount, double Max)[] tanks)
        {
            var set = new Tanks();
            foreach (var (id, amount, max) in tanks)
            {
                set.ById[id] = new Tank { Amount = amount, MaxAmount = max };
            }
            return (new ResourceTransferEngine(set), set);
        }

        private static ResourceTransferStartArgs Args(string[] from, string[] to, double? amount = null) => new ResourceTransferStartArgs
        {
            Resource = "LiquidFuel",
            FromPartIds = from.ToList(),
            ToPartIds = to.ToList(),
            UntilFull = amount == null,
            Amount = amount,
        };

        private static ResourceTransferJob Only(ResourceTransferEngine engine) => Assert.Single(engine.Snapshot("v").Transfers);

        [Fact]
        public void EachDestinationFillsAtATwentiethOfItsCapacityPerSecond()
        {
            var (engine, tanks) = Rig(("a", 360, 360), ("b", 0, 180), ("c", 0, 180));
            Assert.True(engine.Start(Args(new[] { "a" }, new[] { "b", "c" }), 100).Success);

            engine.Step(101);

            Assert.Equal(9, tanks.ById["b"].Amount, 6);
            Assert.Equal(9, tanks.ById["c"].Amount, 6);
            Assert.Equal(18, Only(engine).Rate!.Value, 6);
            Assert.Equal(18, Only(engine).Moved, 6);
        }

        [Fact]
        public void ElapsedGameTimeDrivesTheAmountSoWarpMovesAsMuch()
        {
            var (engine, tanks) = Rig(("a", 360, 360), ("b", 0, 200));
            engine.Start(Args(new[] { "a" }, new[] { "b" }), 0);

            engine.Step(5);

            Assert.Equal(50, tanks.ById["b"].Amount, 6);
        }

        [Fact]
        public void AnAmountEndsOnBoardExactly()
        {
            var (engine, tanks) = Rig(("a", 100, 100), ("b", 0, 100));
            engine.Start(Args(new[] { "a" }, new[] { "b" }, amount: 7), 0);

            engine.Step(1);
            engine.Step(2);

            Assert.Equal(7, tanks.ById["b"].Amount, 6);
            Assert.Equal(TransferEndReason.AmountMoved, Only(engine).EndReason);
        }

        [Fact]
        public void TheSplitFollowsWhichSourcesStillHoldSomething()
        {
            var (engine, tanks) = Rig(("a", 1, 100), ("b", 100, 100), ("c", 0, 200));
            engine.Start(Args(new[] { "a", "b" }, new[] { "c" }), 0);

            engine.Step(0.2);
            engine.Step(0.4);

            Assert.Equal(0, tanks.ById["a"].Amount, 6);
            Assert.Equal(4, tanks.ById["c"].Amount, 6);
        }

        [Fact]
        public void WhatTheDestinationRefusesGoesBackToTheSource()
        {
            var (engine, tanks) = Rig(("a", 100, 100), ("b", 0, 100));
            tanks.ById["b"].DepositCap = 1;
            engine.Start(Args(new[] { "a" }, new[] { "b" }), 0);

            engine.Step(1);

            Assert.Equal(1, tanks.ById["b"].Amount, 6);
            Assert.Equal(99, tanks.ById["a"].Amount, 6);
            Assert.Equal(1, Only(engine).Moved, 6);
        }

        [Fact]
        public void ARefundReachesAnOutOnlySource()
        {
            var (engine, tanks) = Rig(("a", 100, 100), ("b", 0, 100));
            tanks.ById["a"].FlowMode = KspTankFlowMode.Out;
            tanks.ById["b"].DepositCap = 0;
            engine.Start(Args(new[] { "a" }, new[] { "b" }), 0);

            engine.Step(1);

            Assert.Equal(100, tanks.ById["a"].Amount, 6);
        }

        [Fact]
        public void EndsWhenDestinationsAreFull()
        {
            var (engine, _) = Rig(("a", 100, 100), ("b", 95, 100));
            engine.Start(Args(new[] { "a" }, new[] { "b" }), 0);

            engine.Step(10);

            Assert.Equal(TransferEndReason.DestinationsFull, Only(engine).EndReason);
            Assert.Null(Only(engine).Rate);
        }

        [Fact]
        public void EndsWhenSourcesAreEmpty()
        {
            var (engine, _) = Rig(("a", 2, 100), ("b", 0, 1000));
            engine.Start(Args(new[] { "a" }, new[] { "b" }), 0);

            engine.Step(1);

            Assert.Equal(TransferEndReason.SourcesEmpty, Only(engine).EndReason);
        }

        [Fact]
        public void LosingOneSideEndsAsPartsLeftAndLosingBothAsVesselLeft()
        {
            var (engine, tanks) = Rig(("a", 100, 100), ("b", 0, 100), ("c", 100, 100), ("d", 0, 100));
            engine.Start(Args(new[] { "a" }, new[] { "b" }), 0);
            engine.Start(Args(new[] { "c" }, new[] { "d" }), 0);
            tanks.ById.Remove("a");
            tanks.ById.Remove("c");
            tanks.ById.Remove("d");

            engine.Step(1);

            var jobs = engine.Snapshot("v").Transfers;
            Assert.Equal(TransferEndReason.PartsLeft, jobs.Single(j => j.FromPartIds[0] == "a").EndReason);
            Assert.Equal(TransferEndReason.VesselLeft, jobs.Single(j => j.FromPartIds[0] == "c").EndReason);
        }

        [Theory]
        [InlineData(new[] { "a" }, new string[0])]
        [InlineData(new[] { "a" }, new[] { "a" })]
        public void BadListsAreOutOfRange(string[] from, string[] to)
        {
            var (engine, _) = Rig(("a", 100, 100));
            Assert.Equal(CommandErrorCode.Range, engine.Start(Args(from, to), 0).ErrorCode);
        }

        [Fact]
        public void AmountAndUntilFullAreExclusiveAndAmountMustBePositive()
        {
            var (engine, _) = Rig(("a", 100, 100), ("b", 0, 100));
            var both = Args(new[] { "a" }, new[] { "b" });
            both.Amount = 5;
            Assert.Equal(CommandErrorCode.Range, engine.Start(both, 0).ErrorCode);
            Assert.Equal(CommandErrorCode.Range, engine.Start(Args(new[] { "a" }, new[] { "b" }, amount: 0), 0).ErrorCode);
        }

        [Fact]
        public void AMissingTankIsNotFound()
        {
            var (engine, _) = Rig(("a", 100, 100));
            Assert.Equal(CommandErrorCode.NotFound, engine.Start(Args(new[] { "a" }, new[] { "nope" }), 0).ErrorCode);
        }

        [Theory]
        [InlineData(KspTankFlowMode.In, KspTankFlowMode.Both)]
        [InlineData(KspTankFlowMode.None, KspTankFlowMode.Both)]
        [InlineData(KspTankFlowMode.Both, KspTankFlowMode.Out)]
        [InlineData(KspTankFlowMode.Both, KspTankFlowMode.None)]
        public void DirectionLimitsAreCapabilityMismatches(KspTankFlowMode from, KspTankFlowMode to)
        {
            var (engine, tanks) = Rig(("a", 100, 100), ("b", 0, 100));
            tanks.ById["a"].FlowMode = from;
            tanks.ById["b"].FlowMode = to;
            Assert.Equal(CommandErrorCode.CapabilityMismatch, engine.Start(Args(new[] { "a" }, new[] { "b" }), 0).ErrorCode);
        }

        [Fact]
        public void OutOfCrossfeedReachIsRefused()
        {
            var (engine, tanks) = Rig(("a", 100, 100), ("b", 0, 100));
            tanks.ById["b"].Reachable = false;
            Assert.Equal(CommandErrorCode.CapabilityMismatch, engine.Start(Args(new[] { "a" }, new[] { "b" }), 0).ErrorCode);
        }

        [Fact]
        public void ALockedTankIsNotRefusedAsASource()
        {
            // The engine has no lock check at all: the lock stops consumers, never a transfer.
            var (engine, _) = Rig(("a", 100, 100), ("b", 0, 100));
            Assert.True(engine.Start(Args(new[] { "a" }, new[] { "b" }), 0).Success);
        }

        [Fact]
        public void ATankInARunningTransferOfTheResourceIsRefused()
        {
            var (engine, _) = Rig(("a", 100, 100), ("b", 0, 100), ("c", 0, 100));
            engine.Start(Args(new[] { "a" }, new[] { "b" }), 0);
            Assert.Equal(CommandErrorCode.WrongState, engine.Start(Args(new[] { "a" }, new[] { "c" }), 0).ErrorCode);
        }

        [Fact]
        public void NothingToMoveAndNoRoomAreWrongState()
        {
            var (engine, _) = Rig(("a", 0, 100), ("b", 0, 100), ("c", 100, 100), ("d", 100, 100));
            Assert.Equal(CommandErrorCode.WrongState, engine.Start(Args(new[] { "a" }, new[] { "b" }), 0).ErrorCode);
            Assert.Equal(CommandErrorCode.WrongState, engine.Start(Args(new[] { "c" }, new[] { "d" }), 0).ErrorCode);
        }

        [Fact]
        public void StopEndsOneAndAnEndedIdStaysASuccess()
        {
            var (engine, _) = Rig(("a", 100, 100), ("b", 0, 100));
            var id = engine.Start(Args(new[] { "a" }, new[] { "b" }), 0).Payload!.TransferId;

            Assert.True(engine.Stop(new ResourceTransferStopArgs { TransferId = id }, 1).Success);
            Assert.Equal(TransferEndReason.Stopped, Only(engine).EndReason);
            Assert.True(engine.Stop(new ResourceTransferStopArgs { TransferId = id }, 2).Success);
            Assert.Equal(1, Only(engine).EndedUt);
        }

        [Fact]
        public void StopAllEndsEveryRunningTransfer()
        {
            var (engine, _) = Rig(("a", 100, 100), ("b", 0, 100), ("c", 100, 100), ("d", 0, 100));
            engine.Start(Args(new[] { "a" }, new[] { "b" }), 0);
            engine.Start(Args(new[] { "c" }, new[] { "d" }), 0);

            engine.Stop(new ResourceTransferStopArgs { All = true }, 1);

            Assert.All(engine.Snapshot("v").Transfers, j => Assert.Equal(TransferJobState.Ended, j.State));
        }

        [Fact]
        public void StopRefusesAnUnknownIdAndAMalformedRequest()
        {
            var (engine, _) = Rig();
            Assert.Equal(CommandErrorCode.NotFound, engine.Stop(new ResourceTransferStopArgs { TransferId = "nope" }, 0).ErrorCode);
            Assert.Equal(CommandErrorCode.Range, engine.Stop(new ResourceTransferStopArgs(), 0).ErrorCode);
            Assert.Equal(CommandErrorCode.Range, engine.Stop(new ResourceTransferStopArgs { All = true, TransferId = "x" }, 0).ErrorCode);
        }

        [Fact]
        public void KeepsTheLastEightEndedNewestFirstAfterRunningOnes()
        {
            var (engine, _) = Rig(("a", 100, 100), ("b", 0, 100), ("c", 100, 100), ("d", 0, 100));
            for (var i = 0; i < 10; i++)
            {
                var id = engine.Start(Args(new[] { "a" }, new[] { "b" }), i).Payload!.TransferId;
                engine.Stop(new ResourceTransferStopArgs { TransferId = id }, i);
            }
            var running = engine.Start(Args(new[] { "c" }, new[] { "d" }), 20).Payload!.TransferId;

            var jobs = engine.Snapshot("v").Transfers;

            Assert.Equal(9, jobs.Count);
            Assert.Equal(running, jobs[0].Id);
            Assert.Equal("t10", jobs[1].Id);
            Assert.Equal("t3", jobs[8].Id);
        }

        [Fact]
        public void EndAllRecordsTheReason()
        {
            var (engine, _) = Rig(("a", 100, 100), ("b", 0, 100));
            engine.Start(Args(new[] { "a" }, new[] { "b" }), 0);
            engine.EndAll(TransferEndReason.SceneLeft, 3);
            Assert.Equal(TransferEndReason.SceneLeft, Only(engine).EndReason);
        }

        [Fact]
        public void RevisionStaysStillWhenNothingIsRunning()
        {
            var (engine, _) = Rig();
            var before = engine.Revision;
            engine.Step(1);
            engine.Step(2);
            Assert.Equal(before, engine.Revision);
        }
    }
}
