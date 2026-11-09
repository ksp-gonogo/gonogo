using System;
using System.Collections.Generic;
using Gonogo.KSP.Gates;
using Sitrep.Contract;
using Sitrep.Host;

namespace Gonogo.KSP
{
    /// <summary>The game side of resource transfer: tanks on the active vessel, and which of them can exchange.</summary>
    internal sealed class KspResourceTransfers : ITransferTanks
    {
        /// <summary>The rule stock uses to offer a tank for transfer. <c>isVisible</c> keeps out a mod's hidden resources, such as cabin air.</summary>
        public static bool IsTransferable(PartResource resource) =>
            resource.info != null
            && resource.info.resourceTransferMode != ResourceTransferMode.NONE
            && resource.isVisible
            && resource.maxAmount > 0;

        public ITransferTank? Find(string partId, string resource)
        {
            var vessel = ActiveVesselScope.Current;
            if (vessel == null || vessel.parts == null || !uint.TryParse(partId, out var flightId) || flightId == 0)
            {
                return null;
            }

            foreach (var part in vessel.parts)
            {
                if (part != null && part.flightID == flightId && part.State != PartStates.DEAD)
                {
                    var found = part.Resources?.Get(resource);
                    return found == null ? null : new Tank(part, found);
                }
            }

            return null;
        }

        /// <summary>
        /// The reach of every resource on the active vessel. Null with no vessel.
        /// Main thread: reads live parts.
        /// </summary>
        public static TransferReach? BuildReach()
        {
            var vessel = ActiveVesselScope.Current;
            if (vessel == null || vessel.parts == null)
            {
                return null;
            }

            var reach = new TransferReach
            {
                ObeysCrossfeed = ObeysCrossfeed,
                Meta = new PayloadMeta { Source = "vessel:" + vessel.id.ToString("D") },
            };
            if (!reach.ObeysCrossfeed)
            {
                return reach;
            }

            var setIds = new Dictionary<PartSet, int>();
            foreach (var part in vessel.parts)
            {
                if (part?.Resources == null)
                {
                    continue;
                }

                foreach (PartResource resource in part.Resources)
                {
                    if (resource?.info == null || !IsTransferable(resource))
                    {
                        continue;
                    }

                    int? set;
                    switch (resource.info.resourceFlowMode)
                    {
                        case ResourceFlowMode.STACK_PRIORITY_SEARCH:
                        case ResourceFlowMode.STAGE_STACK_FLOW:
                        case ResourceFlowMode.STAGE_STACK_FLOW_BALANCE:
                            if (part.crossfeedPartSet == null)
                            {
                                continue;
                            }
                            set = SetId(setIds, part.crossfeedPartSet, reach, vessel);
                            break;
                        case ResourceFlowMode.NO_FLOW:
                            set = null;
                            break;
                        default:
                            continue;
                    }

                    if (!reach.Resources.TryGetValue(resource.resourceName, out var tanks))
                    {
                        tanks = new List<TankReach>();
                        reach.Resources[resource.resourceName] = tanks;
                    }
                    tanks.Add(new TankReach { PartId = part.flightID.ToString(), DrawsFromSet = set });
                }
            }

            return reach;
        }

        private static bool ObeysCrossfeed =>
            HighLogic.CurrentGame?.Parameters?.CustomParams<GameParameters.AdvancedParams>()?.ResourceTransferObeyCrossfeed == true;

        private static int SetId(Dictionary<PartSet, int> ids, PartSet set, TransferReach reach, Vessel vessel)
        {
            if (ids.TryGetValue(set, out var id))
            {
                return id;
            }

            id = ids.Count;
            ids[set] = id;
            var partIds = new List<string>();
            foreach (var part in vessel.parts)
            {
                if (part != null && set.ContainsPart(part))
                {
                    partIds.Add(part.flightID.ToString());
                }
            }
            reach.Sets.Add(new CrossfeedSet { Id = id, PartIds = partIds });
            return id;
        }

        private sealed class Tank : ITransferTank
        {
            private readonly Part _part;
            private readonly PartResource _resource;

            public Tank(Part part, PartResource resource)
            {
                _part = part;
                _resource = resource;
            }

            public double Amount => _resource.amount;
            public double MaxAmount => _resource.maxAmount;
            public bool Transferable => IsTransferable(_resource);
            public KspTankFlowMode FlowMode => (KspTankFlowMode)(int)_resource.flowMode;

            public bool CanDrawFrom(ITransferTank source) =>
                !ObeysCrossfeed || (source is Tank tank && _part.CanCrossfeed(tank._part, _resource.info.id));

            public double Withdraw(double amount, ITransferTank counterpart) => Move(-amount, counterpart);

            public double Deposit(double amount, ITransferTank counterpart) => Move(amount, counterpart);

            public void Refund(double amount) =>
                _resource.amount = Math.Min(_resource.maxAmount, _resource.amount + amount);

            private double Move(double signedAmount, ITransferTank counterpart)
            {
                var before = _resource.amount;
                // TransferResource applies the tank's direction limit and mixes heat from the other part.
                _part.TransferResource(_resource, signedAmount, counterpart is Tank other ? other._part : _part);
                return Math.Abs(_resource.amount - before);
            }
        }
    }

    /// <summary>Advances running transfers each physics step in flight. Runs whether or not anyone is subscribed, since a transfer is an order the craft is carrying out.</summary>
    [KSPAddon(KSPAddon.Startup.Flight, false)]
    internal sealed class ResourceTransferStepper : UnityEngine.MonoBehaviour
    {
        private void FixedUpdate() => ResourceTransferUplink.Engine?.Step(Planetarium.GetUniversalTime());

        private void OnDestroy() => ResourceTransferUplink.Engine?.EndAll(TransferEndReason.SceneLeft, Planetarium.GetUniversalTime());
    }

    /// <summary>Publishes running transfers and tank reach, and handles the two transfer commands.</summary>
    [SitrepUplink("resource-transfer")]
    public sealed class ResourceTransferUplink : ISitrepUplink
    {
        internal static ResourceTransferEngine? Engine;

        /* Reach depends on staging, docking, crossfeed toggles and a settings change, so polling once a second beats tracking every event that can move it. */
        private const double ReachIntervalSeconds = 1;

        private IChannelPublisher? _transfers;
        private IChannelPublisher? _reach;
        private long _publishedRevision = -1;
        private string _publishedReach = "";
        private float _nextReachAt;

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "resource-transfer",
            Bundled = true,
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                Delayed(ResourceTransferWire.TransfersTopic),
                Delayed(ResourceTransferWire.ReachTopic),
            },
            Commands = new List<CommandDeclaration>
            {
                Command(ResourceTransferWire.StartCommand),
                Command(ResourceTransferWire.StopCommand),
            },
        };

        private static CommandDeclaration Command(string command) => new CommandDeclaration
        {
            Command = command,
            Subject = ResourceTransferWire.TransfersTopic,
            Requires = GateDeclarations.For(command),
        };

        private static ChannelDeclaration Delayed(string topic) => new ChannelDeclaration
        {
            Kind = SampleKind.Continuous,
            Requires = Requirement.None,
            Topic = topic,
            Delivery = Delivery.LossyLatest,
            Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
            Delay = DelayRole.Delayed,
        };

        public void Register(IUplinkHost host)
        {
            var engine = new ResourceTransferEngine(new KspResourceTransfers());
            Engine = engine;
            _transfers = host.Publisher(ResourceTransferWire.TransfersTopic);
            _reach = host.Publisher(ResourceTransferWire.ReachTopic);
            host.AddSampledSource(CaptureOnMain, HandleOnCourier, ResourceTransferWire.TransfersTopic, ResourceTransferWire.ReachTopic);

            host.AddCommandHandler<ResourceTransferStartArgs, CommandResult<ResourceTransferStarted>>(ResourceTransferWire.StartCommand, Start);
            host.AddCommandHandler<ResourceTransferStopArgs, CommandResult>(
                ResourceTransferWire.StopCommand,
                args => engine.Stop(args, Planetarium.GetUniversalTime()));
        }

        private static CommandResult<ResourceTransferStarted> Start(ResourceTransferStartArgs args)
        {
            var vessel = ActiveVesselScope.Current;
            if (vessel == null)
            {
                return CommandResult<ResourceTransferStarted>.Fail(CommandErrorCode.NoVessel);
            }

            var control = ControlInputAuthority.RefusalFor(vessel.IsControllable);
            if (control != null)
            {
                return CommandResult<ResourceTransferStarted>.Fail(control.Value.Code, "the craft has no control source to run its pumps");
            }

            return Engine!.Start(args, Planetarium.GetUniversalTime());
        }

        private object? CaptureOnMain(KspSnapshot? snapshot)
        {
            var engine = Engine;
            if (engine == null)
            {
                return null;
            }

            var ut = snapshot?.Ut ?? Planetarium.GetUniversalTime();
            var capture = new Capture { Ut = ut };
            if (engine.Revision != _publishedRevision)
            {
                _publishedRevision = engine.Revision;
                capture.Transfers = ResourceTransferWire.ToWire(engine.Snapshot(ActiveVesselScope.Current?.id.ToString("D")));
            }

            if (UnityEngine.Time.realtimeSinceStartup >= _nextReachAt)
            {
                _nextReachAt = UnityEngine.Time.realtimeSinceStartup + (float)ReachIntervalSeconds;
                var reach = KspResourceTransfers.BuildReach();
                if (reach != null)
                {
                    var signature = ReachSignature(reach);
                    if (signature != _publishedReach)
                    {
                        _publishedReach = signature;
                        capture.Reach = ResourceTransferWire.ToWire(reach);
                    }
                }
            }

            return capture;
        }

        private void HandleOnCourier(object? captured)
        {
            if (captured is not Capture capture)
            {
                return;
            }

            if (capture.Transfers != null)
            {
                _transfers?.Publish(capture.Transfers, capture.Ut);
            }
            if (capture.Reach != null)
            {
                _reach?.Publish(capture.Reach, capture.Ut);
            }
        }

        private static string ReachSignature(TransferReach reach)
        {
            var parts = new List<string> { reach.Meta.Source, reach.ObeysCrossfeed ? "1" : "0" };
            foreach (var set in reach.Sets)
            {
                parts.Add(set.Id + ":" + string.Join(",", set.PartIds));
            }
            foreach (var kvp in reach.Resources)
            {
                foreach (var tank in kvp.Value)
                {
                    parts.Add(kvp.Key + "=" + tank.PartId + ">" + tank.DrawsFromSet);
                }
            }
            return string.Join("|", parts);
        }

        public UplinkHealth Health() => Engine != null ? UplinkHealth.Healthy : new UplinkHealth(UplinkHealthState.Unavailable, "not registered");

        private sealed class Capture
        {
            public double Ut;
            public Dictionary<string, object?>? Transfers;
            public Dictionary<string, object?>? Reach;
        }
    }
}
