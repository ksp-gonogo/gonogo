using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Host.Reliability;

namespace Gonogo.KSP
{
    /// <summary>
    /// The bundled CORE reliability registration: the reliability analogue of
    /// <see cref="CommsCoreUplink"/>. It OWNS the exclusive <c>"reliability"</c>
    /// capability (registering <see cref="NoneReliabilityBackend"/> as the
    /// always-present Vanilla factory), declares the two <c>reliability.*</c>
    /// channels ONCE, and sources them from whichever backend the election
    /// picked: resolved at capture time via
    /// <c>host.Kernel.Query&lt;IReliabilityBackend&gt;("reliability")</c>. Neither
    /// Kerbalism nor TestFlight declares these channels itself; that is the
    /// shared-namespace-single-declaration rule (same as comms.*).
    ///
    /// <para>Providers register from their OWN uplink's Register:
    /// GonogoKerbalismUplink (Priority 1, reports Coverage "disabled" when
    /// Features.Reliability or mtbfFailures is off) and GonogoTestFlightUplink
    /// (Priority 10, engine-authoritative: wins under RO). Under RO only TestFlight is live;
    /// in stock Kerbalism only Kerbalism is live; both-registered resolves by
    /// priority in the Kernel, never in the client.</para>
    /// </summary>
    [SitrepUplink("reliability")]
    public sealed class ReliabilityCoreUplink : ISitrepUplink, IUplinkCapabilityDeclarer
    {
        public const string SummaryTopic = "reliability.summary";
        public const string PartsTopic = "reliability.parts";

        /// <summary>
        /// Repair one part, by one named crew member, in a SINGLE command.
        ///
        /// <para>Delayed, like any vessel-directed action: it acts on a craft
        /// and rides that craft's signal delay. Which is also why it carries
        /// the whole intent rather than being decomposed into ask-fetch-repair,
        /// since each step would cost its own round trip.</para>
        /// </summary>
        public const string RepairCommand = "vessel.repair";

        private IChannelPublisher? _summary;
        private IChannelPublisher? _parts;
        private Kernel? _kernel;

        /// <summary>
        /// A selected provider threw during Kernel activation, so the elected
        /// instance is the vanilla None backend and its "nothing is installed"
        /// reading is false. Computed once at Register from the Kernel's retained
        /// notices, by notice KIND rather than by sniffing a Detail string.
        /// </summary>
        private bool _activationFailed;

        private bool _lastCaptureFailed;
        private string _lastCaptureError = "";

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "reliability",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                Delayed(SummaryTopic),
                Delayed(PartsTopic),
            },
            Commands = new List<CommandDeclaration>
            {
                Command(RepairCommand, delayed: true),
            },
        };

        private static CommandDeclaration Command(string command, bool delayed) =>
            new CommandDeclaration { Command = command, Delayed = delayed };

        private static ChannelDeclaration Delayed(string topic) => new ChannelDeclaration
        {
            Topic = topic,
            Delivery = Delivery.LossyLatest,
            Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
            Delay = DelayRole.Delayed,
        };

        /// <summary>
        /// Declared HERE in the pre-Register capability pass (two-pass fix, same as
        /// CommsCoreUplink), so the capability exists before any provider uplink's
        /// Register runs, a Kerbalism/TestFlight provider registration can never
        /// race ahead of this declaration regardless of assembly-scan order.
        /// </summary>
        public void DeclareCapabilities(Kernel kernel) => ReliabilityElection.RegisterCapability(kernel);

        public void Register(IUplinkHost host)
        {
            _kernel = host.Kernel;
            _activationFailed = _kernel.LastNotices.Any(n =>
                n.Capability == ReliabilityElection.CapabilityId && n.Kind == "factory-failed");
            _summary = host.Publisher(SummaryTopic);
            _parts = host.Publisher(PartsTopic);
            host.AddSampledSource(CaptureOnMain, HandleOnCourier, SummaryTopic, PartsTopic);
            /*
             * Dispatched to whichever backend won the capability, so the
             * command works on any install and the widget never learns which
             * mod answered. A backend that cannot repair refuses in its own
             * words rather than throwing, so this is always answerable.
             */
            host.AddCommandHandler<RepairPartArgs, CommandResult<RepairOutcome>>(
                RepairCommand,
                args =>
                {
                    var backend = _kernel != null ? ReliabilityElection.Elected(_kernel) : null;
                    if (backend == null)
                    {
                        return CommandResult<RepairOutcome>.Ok(new RepairOutcome
                        {
                            Repaired = false,
                            Refusal = "not-modelled",
                        });
                    }

                    return CommandResult<RepairOutcome>.Ok(
                        backend.Repair(args?.PartId ?? "", args?.CrewName ?? ""));
                });
        }

        /// <summary>MAIN-THREAD capture: resolve the elected backend and read its readouts (live KSP, safe here).</summary>
        private object? CaptureOnMain(KspSnapshot? snapshot)
        {
            var backend = _kernel != null ? ReliabilityElection.Elected(_kernel) : null;
            if (backend == null)
            {
                // Election not resolved yet (pre-flight). Nothing published, and
                // Health() already reports Unavailable for exactly this window.
                return null;
            }
            try
            {
                var summary = backend.Summary();
                if (_activationFailed)
                {
                    // A selected provider threw during Kernel activation, so the
                    // elected instance is the vanilla None backend and its
                    // "no reliability model" reading is false. We are blind.
                    summary.Coverage = ReliabilityCoverage.Unavailable;
                }
                _lastCaptureFailed = false;
                return new ReliabilityCapture
                {
                    Ut = snapshot?.Ut ?? 0.0,
                    Summary = summary,
                    Parts = new List<ReliabilityPartEntry>(backend.Parts()),
                };
            }
            catch (Exception ex)
            {
                // A read that threw used to publish NOTHING, which left the client
                // Reading pending forever while Health() still said Healthy: a
                // blind channel that looked like a cold start. Publish the blindness.
                _lastCaptureFailed = true;
                _lastCaptureError = ex.Message;
                UnityEngine.Debug.LogError("[Gonogo] reliability capture threw: " + ex.Message);
                return new ReliabilityCapture
                {
                    Ut = snapshot?.Ut ?? 0.0,
                    Summary = new ReliabilitySummary
                    {
                        Source = backend.ProviderId,
                        Coverage = ReliabilityCoverage.Unavailable,
                    },
                    Parts = new List<ReliabilityPartEntry>(),
                };
            }
        }

        /// <summary>COURIER-THREAD handle: publish the captured payloads. No KSP access.</summary>
        private void HandleOnCourier(object? captured)
        {
            if (captured is not ReliabilityCapture capture)
            {
                return;
            }
            _summary?.Publish(capture.Summary, capture.Ut);
            _parts?.Publish(capture.Parts, capture.Ut);
        }

        public UplinkHealth Health()
        {
            if (_kernel == null || ReliabilityElection.Elected(_kernel) == null)
            {
                return new UplinkHealth(UplinkHealthState.Unavailable, "reliability capability not resolved");
            }
            if (_activationFailed)
            {
                return new UplinkHealth(
                    UplinkHealthState.Degraded,
                    "a reliability provider failed to activate; using the vanilla fallback");
            }
            if (_lastCaptureFailed)
            {
                return new UplinkHealth(UplinkHealthState.Degraded, "reliability capture threw: " + _lastCaptureError);
            }
            return UplinkHealth.Healthy;
        }

        private sealed class ReliabilityCapture
        {
            public double Ut;
            public ReliabilitySummary Summary = new();
            public List<ReliabilityPartEntry> Parts = new();
        }
    }
}
