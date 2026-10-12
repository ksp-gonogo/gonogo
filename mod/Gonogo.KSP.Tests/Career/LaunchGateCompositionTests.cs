using System;
using System.Collections.Generic;
using Gonogo.KSP.Gates;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Gonogo.KSP.Tests.Career
{
    /// <summary>
    /// <c>ksp.launch</c> is gated on two different arguments by two different
    /// authors: core judges the launch site, and a career mod judges the vehicle.
    /// Both sets are enforced on one real engine, which starts.
    /// </summary>
    public class LaunchGateCompositionTests
    {
        private const string Command = "ksp.launch";
        private const string Vehicle = "shipName";
        private const string VehicleKind = "test-vehicle-rolled-out";

        [Fact]
        public void TheSiteGateAndAVehicleGateOnTheSameLaunchAreBothEnforced()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new CoreLaunchStandIn());
            engine.RegisterUplink(new VehicleGateUplink());
            engine.Start();
            try
            {
                Assert.True(engine.AvailabilityOf(CoreLaunchStandIn.Id).IsAvailable);
                Assert.True(engine.AvailabilityOf(VehicleGateUplink.Id).IsAvailable);

                var occupiedPad = engine.EvaluateGates(Command, new Args("LaunchPad", "Ready"));
                Assert.Equal(GateOutcome.Fail, occupiedPad.Outcome);
                Assert.Equal(CommandErrorCode.SiteOccupied, occupiedPad.ErrorCode);

                var unrolled = engine.EvaluateGates(Command, new Args("Runway", "Unrolled"));
                Assert.Equal(GateOutcome.Fail, unrolled.Outcome);
                Assert.Equal(CommandErrorCode.WrongState, unrolled.ErrorCode);

                Assert.Equal(GateOutcome.Pass, engine.EvaluateGates(Command, new Args("Runway", "Ready")).Outcome);
            }
            finally
            {
                engine.Stop();
            }
        }

        private sealed class Args : IGateArguments
        {
            private readonly Dictionary<string, object> _values = new Dictionary<string, object>(StringComparer.Ordinal);

            public Args(string site, string ship)
            {
                _values["site"] = site;
                _values[Vehicle] = ship;
            }

            public bool TryGet(string path, out object value) => _values.TryGetValue(path, out value!);
        }

        /// <summary>
        /// Core's own <c>ksp.launch</c> requirements, exactly as declared, with
        /// stand-ins for the evaluators that read the live game.
        /// </summary>
        private sealed class CoreLaunchStandIn : ISitrepUplink
        {
            public const string Id = "core-launch-stand-in";

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest => new UplinkManifest
            {
                Id = Id,
                Version = "1.0.0",
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration
                    {
                        Command = Command,
                        Delay = DelayRole.TrueNow,
                        Requires = GateDeclarations.For(Command),
                    },
                },
            };

            public void Register(IUplinkHost host)
            {
                host.AddGateEvaluator(new SceneStandIn());
                host.AddGateEvaluator(new SiteStandIn());
                host.AddCommandHandler<object?, CommandResult>(Command, _ => CommandResult.Ok());
            }
        }

        private sealed class SceneStandIn : ICommandGateEvaluator
        {
            public string Kind => KspGateEvaluators.Kinds.Scene;

            public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments) => GateVerdict.Pass();
        }

        private sealed class SiteStandIn : ICommandGateEvaluator, ICommandGateItems
        {
            public string Kind => KspGateEvaluators.Kinds.PreFlight;

            public IEnumerable<string> Items(CommandRequirement requirement) => new[] { "LaunchPad", "Runway" };

            public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments)
            {
                arguments.TryGet("site", out var site);
                return requirement.Quantity == KspGateEvaluators.Quantities.LaunchSiteClear && (site as string) == "LaunchPad"
                    ? GateVerdict.Fail(CommandErrorCode.SiteOccupied, "a craft is on the pad")
                    : GateVerdict.Pass();
            }
        }

        private sealed class VehicleGateUplink : ISitrepUplink
        {
            public const string Id = "vehicle-gate";

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest => new UplinkManifest { Id = Id, Version = "1.0.0" };

            public void Register(IUplinkHost host)
            {
                host.AddGateEvaluator(new VehicleStandIn());
                host.AddCommandRequirement(
                    Command,
                    new CommandRequirement { Kind = VehicleKind, Needs = new[] { Vehicle } });
            }
        }

        private sealed class VehicleStandIn : ICommandGateEvaluator, ICommandGateItems
        {
            public string Kind => VehicleKind;

            public IEnumerable<string> Items(CommandRequirement requirement) => new[] { "Ready", "Unrolled" };

            public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments)
            {
                arguments.TryGet(Vehicle, out var ship);
                return (ship as string) == "Unrolled"
                    ? GateVerdict.Fail(CommandErrorCode.WrongState, "not rolled out")
                    : GateVerdict.Pass();
            }
        }
    }
}
