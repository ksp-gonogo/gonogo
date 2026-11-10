using System;
using System.Collections.Generic;
using System.Linq;
using Gonogo.KSP.Gates;
using HarmonyLib;
using Sitrep.Contract;

namespace Gonogo.KSP.GameWindows
{
    /// <summary>
    /// Reads windows that a part's menu opens on the game's screen and publishes
    /// each as a tree of controls, and carries a press of one of those controls
    /// back to the window as an ordinary delayed command.
    /// </summary>
    [SitrepUplink(UplinkId)]
    public sealed class GameWindowsUplink : ISitrepUplink
    {
        public const string UplinkId = "gameWindows";
        private const string WindowsTopic = GameWindowIds.WindowsTopic;
        private const string PressCommand = GameWindowIds.PressCommand;

        private static bool _patched;
        private IChannelPublisher? _windows;

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = UplinkId,
            Bundled = true,
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                new ChannelDeclaration
                {
                    Kind = SampleKind.Discrete,
                    Requires = Requirement.None,
                    Topic = WindowsTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    Delay = DelayRole.Delayed,
                },
            },
            Commands = new List<CommandDeclaration>
            {
                new CommandDeclaration
                {
                    Command = PressCommand,
                    Subject = WindowsTopic,
                    Requires = GateDeclarations.For(PressCommand),
                },
            },
        };

        public UplinkHealth Health() => UplinkHealth.Healthy;

        public void Register(IUplinkHost host)
        {
            if (!_patched)
            {
                _patched = true;
                var harmony = new Harmony("gonogo.gamewindows");
                ImguiCapture.Patch(harmony);
                OpenerWatch.Patch(harmony);
            }
            _windows = host.Publisher(WindowsTopic);
            host.AddSampledSource(Capture, Publish);
            host.AddCommandHandler<PressGameWindowControlArgs, CommandResult>(PressCommand, Press);
        }

        private object? Capture(KspSnapshot? snapshot)
        {
            UguiCapture.Tick();
            var windows = ImguiCapture.Wire().Concat(UguiCapture.Wire()).Select(w => (object?)w).ToList();
            return new CaptureFrame(new Dictionary<string, object?> { ["windows"] = windows }, Planetarium.GetUniversalTime());
        }

        private void Publish(object? captured)
        {
            if (_windows == null || captured is not CaptureFrame frame) return;
            _windows.Publish(frame.Payload, frame.Ut);
        }

        private static CommandResult Press(PressGameWindowControlArgs args)
        {
            var press = new Press
            {
                ControlId = args.ControlId,
                Bool = args.Bool ?? false,
                Num = args.Num ?? 0,
                Text = args.Text,
            };
            var refusal = Drive(args.WindowId, press);
            return refusal == null ? CommandResult.Ok() : CommandResult.Fail(CommandErrorCode.NotFound, refusal);
        }

        private static string? Drive(string windowId, Press press)
        {
            if (windowId.StartsWith("imgui:", StringComparison.Ordinal)
                && int.TryParse(windowId.Substring(6), out var id))
            {
                return ImguiCapture.Enqueue(id, press);
            }

            if (windowId.StartsWith("ugui:", StringComparison.Ordinal))
            {
                return UguiCapture.Drive(windowId, press);
            }

            return PressRefusal.WindowClosed;
        }

        private sealed class CaptureFrame
        {
            public readonly Dictionary<string, object?> Payload;
            public readonly double Ut;

            public CaptureFrame(Dictionary<string, object?> payload, double ut)
            {
                Payload = payload;
                Ut = ut;
            }
        }
    }
}
