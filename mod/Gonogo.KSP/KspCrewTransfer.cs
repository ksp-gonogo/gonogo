using System.Collections.Generic;
using Gonogo.KSP.Gates;
using Sitrep.Contract;
using Sitrep.Host;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>Moves a kerbal between parts of the active vessel the way the game's own transfer does, asking the same events.</summary>
    internal static class KspCrewTransfer
    {
        internal static bool RespawnPending;
        internal static int RespawnAfterFrame;

        private static bool IsExternalSeat(Part part) =>
            part.FindModuleImplementing<KerbalSeat>() != null || part.FindModuleImplementing<KerbalEVA>() != null;

        private static PartSeats? Seats(Part part) =>
            part.CrewCapacity <= 0
                ? null
                : new PartSeats
                {
                    Capacity = part.CrewCapacity,
                    TransferAvailable = part.crewTransferAvailable,
                    IsExternalSeat = IsExternalSeat(part),
                };

        /// <summary>The <c>seats</c> object for a part's row on <c>vessel.parts</c>, or null with no seats.</summary>
        public static Dictionary<string, object?>? SeatsWire(Part part)
        {
            var seats = Seats(part);
            return seats == null
                ? null
                : new Dictionary<string, object?>
                {
                    ["capacity"] = seats.Capacity,
                    ["transferAvailable"] = seats.TransferAvailable,
                    ["isExternalSeat"] = seats.IsExternalSeat,
                };
        }

        /// <summary>
        /// The parts this kerbal could move into that would leave the craft with no
        /// control, judged with each command module's own minimum crew and, for a
        /// module the move does not touch, its current state.
        /// </summary>
        public static List<string> MovesLeavingNoControl(Vessel vessel, ProtoCrewMember kerbal)
        {
            var result = new List<string>();
            var source = kerbal.seat?.part ?? FindHolder(vessel, kerbal);
            if (source == null || !vessel.IsControllable)
            {
                return result;
            }

            foreach (var destination in vessel.parts)
            {
                if (destination == source || destination.CrewCapacity <= 0 || !destination.crewTransferAvailable)
                {
                    continue;
                }
                if (destination.protoModuleCrew.Count < destination.CrewCapacity
                    && !ControlSurvives(vessel, kerbal, source, destination))
                {
                    result.Add(destination.flightID.ToString());
                }
            }
            return result;
        }

        private static bool ControlSurvives(Vessel vessel, ProtoCrewMember kerbal, Part source, Part destination)
        {
            foreach (var part in vessel.parts)
            {
                var command = part.FindModuleImplementing<ModuleCommand>();
                if (command == null)
                {
                    continue;
                }

                if (part != source && part != destination)
                {
                    if (command.ModuleState == ModuleCommand.ModuleControlState.Nominal
                        || command.ModuleState == ModuleCommand.ModuleControlState.PartialManned
                        || command.ModuleState == ModuleCommand.ModuleControlState.PartialProbe)
                    {
                        return true;
                    }
                    continue;
                }

                var counted = 0;
                foreach (var member in part.protoModuleCrew)
                {
                    if (member != kerbal && member.type != ProtoCrewMember.KerbalType.Tourist && !member.inactive)
                    {
                        counted++;
                    }
                }
                if (part == destination && kerbal.type != ProtoCrewMember.KerbalType.Tourist && !kerbal.inactive)
                {
                    counted++;
                }
                if (counted >= command.minimumCrew)
                {
                    return true;
                }
            }
            return false;
        }

        private static Part? FindHolder(Vessel vessel, ProtoCrewMember kerbal)
        {
            foreach (var part in vessel.parts)
            {
                if (part.protoModuleCrew.Contains(kerbal))
                {
                    return part;
                }
            }
            return null;
        }

        public static CommandResult Move(CrewTransferArgs args)
        {
            var vessel = ActiveVesselScope.Current;
            if (vessel == null || vessel.parts == null)
            {
                return CommandResult.Fail(CommandErrorCode.NoVessel);
            }

            ProtoCrewMember? kerbal = null;
            Part? source = null;
            Part? destination = null;
            foreach (var part in vessel.parts)
            {
                if (part.flightID.ToString() == args.ToPartId)
                {
                    destination = part;
                }
                foreach (var member in part.protoModuleCrew)
                {
                    if (member.name == args.KerbalName)
                    {
                        kerbal = member;
                        source = part;
                    }
                }
            }

            var facts = new CrewMoveFacts
            {
                Busy = PartItemTransfer.Instance != null
                    ? "a transfer is open in the game"
                    : RespawnPending ? "a move is finishing" : null,
                KerbalAboard = kerbal != null,
                KerbalPartId = source?.flightID.ToString(),
                Source = source == null ? null : Seats(source),
                DestinationExists = destination != null,
                Destination = destination == null ? null : Seats(destination),
                DestinationCrew = destination?.protoModuleCrew.Count ?? 0,
            };
            var refusal = CrewTransferRule.Refusal(args, facts);
            if (refusal != null)
            {
                return CommandResult.Fail(refusal.Value.Code, refusal.Value.Detail);
            }

            var modRefusal = AskTheGame(kerbal!, source!, destination!, vessel);
            if (modRefusal != null)
            {
                return CommandResult.Fail(CommandErrorCode.NotClearToProceed, modRefusal);
            }

            /* A hatch dialog left open for this kerbal could act on a part they have left and put them in two parts. */
            var controller = CrewHatchController.fetch;
            if (controller != null)
            {
                controller.DisableInterface();
                controller.EnableInterface();
            }

            var camera = CameraManager.Instance;
            if (camera != null
                && (camera.currentCameraMode == CameraManager.CameraMode.IVA
                    || camera.currentCameraMode == CameraManager.CameraMode.Internal))
            {
                camera.SetCameraFlight();
            }

            source!.RemoveCrewmember(kerbal);
            destination!.AddCrewmember(kerbal);
            ScreenMessages.PostScreenMessage(kerbal!.name + " moved to " + destination.partInfo.title, 5f);
            GameEvents.onCrewTransferred.Fire(new GameEvents.HostedFromToAction<ProtoCrewMember, Part>(kerbal, source, destination));
            Vessel.CrewWasModified(source.vessel, destination.vessel);
            vessel.DespawnCrew();
            RespawnPending = true;
            RespawnAfterFrame = Time.frameCount;
            return CommandResult.Ok();
        }

        /*
         * Mods such as Connected Living Space veto through the game's transfer
         * events, and read the CrewTransfer they are handed. So a real instance is
         * built, with the side-effect-free half of Setup, and destroyed before it
         * can reach a LateUpdate. Setup's other half is the input lock and part
         * highlighting a remote move must not take.
         */
        private static string? AskTheGame(ProtoCrewMember kerbal, Part source, Part destination, Vessel vessel)
        {
            var controller = CrewHatchController.fetch;
            if (controller != null)
            {
                controller.overrideTransfer = false;
                GameEvents.onAttemptTransfer.Fire(kerbal, source, controller);
                if (controller.overrideTransfer)
                {
                    return "kept out by a mod on this craft";
                }
            }

            var valid = new List<Part>();
            var semiValid = new List<Part>();
            foreach (var part in vessel.parts)
            {
                if (part == source || part.CrewCapacity <= 0 || !part.crewTransferAvailable)
                {
                    continue;
                }
                (part.protoModuleCrew.Count < part.CrewCapacity ? valid : semiValid).Add(part);
            }

            var host = new GameObject("Gonogo Crew Transfer");
            try
            {
                var transfer = host.AddComponent<CrewTransfer>();
                transfer.crew = kerbal;
                transfer.srcPart = source;
                transfer.validParts = valid;
                transfer.semiValidParts = semiValid;
                transfer.partSelectors = new List<PartSelector>();
                transfer.scMsgInstruction = new ScreenMessage("", 0f, ScreenMessageStyle.UPPER_CENTER);
                transfer.scMsgWarning = new ScreenMessage("", 0f, ScreenMessageStyle.UPPER_CENTER);

                GameEvents.onCrewTransferPartListCreated.Fire(new GameEvents.HostedFromToAction<Part, List<Part>>(source, valid, semiValid));
                if (!valid.Contains(destination))
                {
                    return "kept out by a mod on this craft";
                }

                var data = new CrewTransfer.CrewTransferData
                {
                    canTransfer = true,
                    crewMember = kerbal,
                    sourcePart = source,
                    destPart = destination,
                    transfer = transfer,
                };
                GameEvents.onCrewTransferSelected.Fire(data);
                return data.canTransfer ? null : "kept out by a mod on this craft";
            }
            finally
            {
                Object.DestroyImmediate(host);
            }
        }
    }

    /// <summary>Respawns the crew portraits a frame after a move, as the game's own transfer does.</summary>
    [KSPAddon(KSPAddon.Startup.Flight, false)]
    internal sealed class CrewTransferRespawner : MonoBehaviour
    {
        private void Update()
        {
            if (KspCrewTransfer.RespawnPending && Time.frameCount > KspCrewTransfer.RespawnAfterFrame)
            {
                KspCrewTransfer.RespawnPending = false;
                ActiveVesselScope.Current?.SpawnCrew();
            }
        }

        private void OnDestroy() => KspCrewTransfer.RespawnPending = false;
    }

    /// <summary>Handles <c>vessel.crew.transfer</c>.</summary>
    [SitrepUplink("crew-transfer")]
    public sealed class CrewTransferUplink : ISitrepUplink
    {
        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "crew-transfer",
            Bundled = true,
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>(),
            Commands = new List<CommandDeclaration>
            {
                new CommandDeclaration
                {
                    Command = CrewTransferRule.Command,
                    Subject = "vessel.crew",
                    Requires = GateDeclarations.For(CrewTransferRule.Command),
                },
            },
        };

        public void Register(IUplinkHost host) =>
            host.AddCommandHandler<CrewTransferArgs, CommandResult>(CrewTransferRule.Command, KspCrewTransfer.Move);

        public UplinkHealth Health() => UplinkHealth.Healthy;
    }
}
