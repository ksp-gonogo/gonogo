using System;
using System.Collections.Generic;
using System.Globalization;
using CommNet;
using Sitrep.Contract;

namespace Gonogo.RealAntennasUplink
{
    /// <summary>
    /// The RealAntennas-and-KSP-touching half of antenna targeting: reads the
    /// reported craft's antennas for <c>realantennas.antennas</c>, and applies
    /// the two commands that write to them.
    ///
    /// <para>MAIN THREAD ONLY, both halves. The read runs from the Uplink's
    /// capture-on-main hook; the writes create a <c>GameObject</c> and add a
    /// component, and the production <c>ChannelEngine</c> is constructed
    /// <c>executeCommandsOnMainThread: true</c>, so every command handler is
    /// marshaled onto the KSP main thread before it runs. That is the same
    /// guarantee this repository's other actuators rely on rather than each
    /// carrying a dispatcher of its own.</para>
    ///
    /// <para>Nothing here names a RealAntennas type. The reads go through
    /// <see cref="RaReflection"/>, and the write path's one argument is a stock
    /// KSP <c>ConfigNode</c>, which is what lets the whole targeting surface be
    /// reached at arm's length.</para>
    ///
    /// <para>The plan a request lowers to, and every refusal that can be decided
    /// without the game, live in <see cref="RaTargetPlan"/>, which is KSP-free
    /// and tested headlessly. This class resolves handles and performs effects.</para>
    ///
    /// <para><b>There is deliberately no clear-target command, and there should
    /// not be one.</b> Both commands here MOVE an antenna between targets, which
    /// is the only thing RealAntennas itself does to a vessel dish: it assigns a
    /// null target in exactly one place, for a ground station. An antenna holding
    /// no target takes no pointing loss in any direction, so a command that put a
    /// vessel dish there would hand the operator a full-gain dish pointed
    /// everywhere at once. It is also the state a dish is in in the editor,
    /// before its first planetarium scene initialises it, and the module disables
    /// its own targeting button while an antenna is in it. Untargeted is what a
    /// dish has not been set up yet, not a mode to return one to.</para>
    /// </summary>
    public sealed class RaTargeting
    {
        private readonly RaReflection _ra;

        public RaTargeting(RaReflection ra)
        {
            _ra = ra;
        }

        /// <summary>
        /// MAIN THREAD: one <see cref="RealAntennasAntennaState"/> per antenna on
        /// the reported craft, in RealAntennas' own list order. Empty when there
        /// is no craft or it carries no RealAntennas antenna, which is a real
        /// answer rather than typed absence: the previous craft's antennas must
        /// not stay on the wire across a vessel switch.
        /// </summary>
        public List<RealAntennasAntennaState> ReadAntennas(Vessel? vessel)
        {
            var states = new List<RealAntennasAntennaState>();
            var antennas = Antennas(vessel);
            if (antennas.Count == 0)
            {
                return states;
            }

            var modeTechLevels = _ra.TargetModeTechLevels();
            var meta = new PayloadMeta
            {
                Source = vessel != null ? "vessel:" + vessel.id : "game",
                Quality = vessel != null && vessel.loaded ? Quality.Loaded : Quality.OnRails,
            };

            var ids = AntennaIds(antennas);
            for (var i = 0; i < antennas.Count; i++)
            {
                var antenna = antennas[i];
                var techLevel = _ra.TechLevel(antenna);
                var beamwidth = _ra.Beamwidth(antenna);
                var targeted = _ra.Targeted(antenna) ?? false;
                var state = new RealAntennasAntennaState
                {
                    AntennaId = ids[i],
                    Index = i,
                    Name = _ra.AntennaName(antenna),
                    Steerable = _ra.Steerable(antenna) ?? false,
                    Targeted = targeted,
                    Gain = _ra.Gain(antenna),
                    TechLevel = techLevel,
                    Beamwidth = beamwidth,
                    // RealAntennas draws the 3 dB cone at half the beamwidth and
                    // the 10 dB cone at all of it (RACommNetScenario's MapUI
                    // settings), so both come off the one number rather than the
                    // client having to know the factor.
                    Cone3Db = beamwidth / 2.0,
                    Cone10Db = beamwidth,
                    MinimumDistance = _ra.MinimumDistance(antenna),
                    AvailableTargetModes = RaTargetPlan.UnlockedModes(techLevel, modeTechLevels),
                    Meta = meta,
                };

                // `Targeted` is the authority on whether there IS a target, not a
                // null check on the handle: a target is a Unity component, and a
                // destroyed one is non-null to C# while RealAntennas itself reads
                // it as absent.
                if (targeted)
                {
                    DescribeTarget(state, _ra.Target(antenna));
                }
                states.Add(state);
            }
            return states;
        }

        /// <summary>
        /// MAIN THREAD: <c>realantennas.antenna.target</c>. Points one antenna at
        /// one thing, then invalidates the network cache.
        /// </summary>
        public CommandResult Target(Vessel? vessel, RealAntennasTargetArgs? args)
        {
            if (args == null)
            {
                return CommandResult.Fail(CommandErrorCode.Range, "No arguments supplied.");
            }
            if (!TryResolveSteerable(vessel, args.AntennaId, out var antenna, out var refusal))
            {
                return refusal!;
            }

            var mode = args.Mode ?? "";
            if (!RaTargetPlan.IsKnownMode(mode))
            {
                return CommandResult.Fail(
                    CommandErrorCode.Range,
                    "Unknown target mode '" + mode + "'. Expected one of: "
                        + string.Join(", ", RaTargetPlan.AllModes) + ".");
            }

            var techLevel = _ra.TechLevel(antenna!);
            if (!RaTargetPlan.ModeIsUnlocked(mode, techLevel, _ra.TargetModeTechLevels(), out var required))
            {
                return TechLevelRefusal(mode, techLevel, required);
            }

            // The body is resolved here rather than in the plan because
            // FlightGlobals is KSP's; the plan only needs the name it settled on
            // and, for a body's centre, its radius.
            CelestialBody? body = null;
            if (mode == RaTargetPlan.ModeBodyCenter || mode == RaTargetPlan.ModeBodyLatLonAlt)
            {
                body = ResolveBody(args.BodyName);
            }

            if (!RaTargetPlan.TryBuild(
                    args,
                    OwnVesselId(antenna!, vessel),
                    body?.name,
                    body?.Radius ?? 0.0,
                    out var values,
                    out var error,
                    out var detail))
            {
                return CommandResult.Fail(error, detail);
            }

            return Apply(antenna!, values);
        }

        /// <summary>
        /// MAIN THREAD: <c>realantennas.antenna.targetHome</c>. Hands the antenna
        /// to RealAntennas' own <c>SetDefaultTarget()</c>, then invalidates the
        /// network cache.
        ///
        /// <para><b>"Home" here is the home body's CENTRE, and nothing else.</b>
        /// That is what <c>SetDefaultTarget</c> writes: a fixed point on
        /// <c>Planetarium.fetch.Home</c> at latitude 0, longitude 0, altitude
        /// minus the body's radius. It is not the space centre, not the ground
        /// station currently carrying the link, and not the best station
        /// available. Producing exactly what RealAntennas produces is the point:
        /// an antenna aimed by this command is indistinguishable from one
        /// RealAntennas defaulted itself, and the alternatives all require a
        /// policy about which station and when to re-aim, which this command does
        /// not have and does not invent.</para>
        ///
        /// <para><b>The unloaded-craft guard.</b> <c>SetDefaultTarget</c> has one
        /// branch that assigns a null target, for a ground station, and assigning
        /// null is the one write on this surface that throws. The throw is not a
        /// refusal: the setter has already cleared the antenna and already
        /// deleted its persisted <c>TARGET</c> node by the time it happens, so a
        /// caller that caught it would report failure having destroyed the saved
        /// aim point. The condition that makes the throw reachable is a non-null
        /// <c>ParentSnapshot</c>, so that is refused up front here. RealAntennas'
        /// own invariant is that a ground station never has one, but relying on
        /// somebody else's invariant to avoid an unrecoverable write is not worth
        /// the line it would save.</para>
        /// </summary>
        public CommandResult TargetHome(Vessel? vessel, RealAntennasAntennaArgs? args)
        {
            if (args == null)
            {
                return CommandResult.Fail(CommandErrorCode.Range, "No arguments supplied.");
            }
            if (!TryResolveSteerable(vessel, args.AntennaId, out var antenna, out var refusal))
            {
                return refusal!;
            }

            if (_ra.ParentSnapshot(antenna!) != null)
            {
                return CommandResult.Fail(
                    CommandErrorCode.WrongState,
                    "This antenna belongs to an unloaded craft, where RealAntennas' default-target call can clear the antenna and delete its saved aim point without completing. Refused rather than attempted.");
            }

            var techLevel = _ra.TechLevel(antenna!);
            if (!RaTargetPlan.ModeIsUnlocked(
                    RaTargetPlan.ModeBodyCenter, techLevel, _ra.TargetModeTechLevels(), out var required))
            {
                return TechLevelRefusal(RaTargetPlan.ModeBodyCenter, techLevel, required);
            }

            if (!_ra.InvokeVoid(antenna, "SetDefaultTarget"))
            {
                return CommandResult.Fail(
                    CommandErrorCode.Unknown,
                    "RealAntennas' SetDefaultTarget could not be invoked.");
            }

            InvalidateCache();
            return CommandResult.Ok();
        }

        /// <summary>
        /// Builds the <c>TARGET</c> node from the plan's values, hands it to
        /// RealAntennas, assigns the result, and invalidates the cache.
        ///
        /// <para>The invalidate is not housekeeping and it is not optional.
        /// RealAntennas' link solver reads antennas out of a mirror that
        /// refreshes the aim DIRECTION on every network rebuild but the
        /// has-a-target flag only on a full re-gather. Without the invalidate a
        /// dish that had no target keeps being solved as though it still had
        /// none, for as long as nothing else happens to trigger a re-gather:
        /// the property reads as targeted, the in-game field updates, the cone
        /// draws, and the link the operator is watching is computed off the old
        /// state.</para>
        /// </summary>
        private CommandResult Apply(object antenna, Dictionary<string, string> values)
        {
            var node = new ConfigNode("TARGET");
            foreach (var pair in values)
            {
                node.AddValue(pair.Key, pair.Value);
            }

            var target = _ra.LoadTargetFromConfig(node, antenna);
            if (target == null)
            {
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RealAntennas declined to build a target for mode '" + values["name"] + "'.");
            }
            if (!_ra.SetTarget(antenna, target))
            {
                return CommandResult.Fail(
                    CommandErrorCode.Unknown,
                    "The target was built but could not be assigned to the antenna.");
            }

            InvalidateCache();
            return CommandResult.Ok();
        }

        /// <summary>
        /// <c>RACommNetNetwork.InvalidateCache()</c>, reached off the live
        /// <c>CommNetScenario.Instance</c> so no RealAntennas type is named. A
        /// failed read is left silent: it means RealAntennas is not the running
        /// comms network, in which case the write above did nothing to a solver
        /// that exists.
        /// </summary>
        private void InvalidateCache() =>
            _ra.InvokeVoid(_ra.ReadPublicMember(CommNetScenario.Instance, "Network"), "InvalidateCache");

        /// <summary>
        /// Resolves an antenna id to a steerable antenna on the reported craft,
        /// or the refusal that says why not.
        /// </summary>
        private bool TryResolveSteerable(
            Vessel? vessel, string? antennaId, out object? antenna, out CommandResult? refusal)
        {
            antenna = null;
            refusal = null;
            if (vessel == null)
            {
                refusal = CommandResult.Fail(CommandErrorCode.NoVessel);
                return false;
            }

            var antennas = Antennas(vessel);
            var ids = AntennaIds(antennas);
            var index = Array.IndexOf(ids, antennaId ?? "");
            if (index < 0)
            {
                refusal = CommandResult.Fail(
                    CommandErrorCode.NotFound,
                    "No antenna '" + (antennaId ?? "") + "' on this craft.");
                return false;
            }

            antenna = antennas[index];
            if (_ra.Steerable(antenna) is not true)
            {
                refusal = CommandResult.Fail(
                    CommandErrorCode.CapabilityMismatch,
                    "'" + (_ra.AntennaName(antenna) ?? antennaId) + "' is an omni antenna and cannot be aimed.");
                antenna = null;
                return false;
            }
            return true;
        }

        private static CommandResult TechLevelRefusal(string mode, int? techLevel, int required) =>
            CommandResult.Fail(
                CommandErrorCode.NotUnlocked,
                "This install gates '" + mode + "' targeting at tech level " + required
                    + "; this antenna is at "
                    + (techLevel?.ToString(CultureInfo.InvariantCulture) ?? "an unreadable level") + ".");

        /// <summary>The RealAntennas antennas of a craft, empty when there are none to read.</summary>
        private IReadOnlyList<object> Antennas(Vessel? vessel) =>
            _ra.NodeAntennas(vessel?.connection?.Comm);

        /// <summary>
        /// The command address for each antenna, in list order: the flight id of
        /// the part it belongs to, plus an ordinal that separates several
        /// antennas on one part.
        ///
        /// <para>A bare position would not survive the delay. Both commands are
        /// delayed, so one dispatched against "the second antenna" arrives
        /// against whatever is second by then, and a part staged or decoupled in
        /// between aims a different dish than the one the operator was looking
        /// at. Falls back to the position for an antenna whose part cannot be
        /// read, which is an unloaded craft: an unstable address is still better
        /// than none, and the command that could destroy an aim point refuses
        /// that craft anyway.</para>
        /// </summary>
        private string[] AntennaIds(IReadOnlyList<object> antennas)
        {
            var ids = new string[antennas.Count];
            var seen = new Dictionary<string, int>();
            for (var i = 0; i < antennas.Count; i++)
            {
                var flightId = FlightId(antennas[i]);
                if (flightId == null)
                {
                    ids[i] = "index/" + i.ToString(CultureInfo.InvariantCulture);
                    continue;
                }
                seen.TryGetValue(flightId, out var ordinal);
                seen[flightId] = ordinal + 1;
                ids[i] = flightId + "/" + ordinal.ToString(CultureInfo.InvariantCulture);
            }
            return ids;
        }

        /// <summary>The flight id of the part an antenna belongs to, or null while its craft is unloaded.</summary>
        private string? FlightId(object antenna)
        {
            var part = _ra.ReadPublicMember(_ra.Parent(antenna), "part") as Part;
            return part == null ? null : part.flightID.ToString(CultureInfo.InvariantCulture);
        }

        /// <summary>
        /// The craft an antenna's own attitude modes are measured from. Taken off
        /// the antenna's own comm node rather than from the reported vessel, the
        /// same walk RealAntennas' targeting window makes, so an azimuth is
        /// always relative to the craft the dish is bolted to.
        /// </summary>
        private string? OwnVesselId(object antenna, Vessel? fallback)
        {
            var vessel = _ra.ReadPublicMember(_ra.ReadPublicMember(antenna, "ParentNode"), "ParentVessel") as Vessel
                ?? fallback;
            return vessel == null ? null : vessel.id.ToString();
        }

        private static CelestialBody? ResolveBody(string? name)
        {
            if (string.IsNullOrEmpty(name))
            {
                return Planetarium.fetch != null ? Planetarium.fetch.Home : null;
            }
            return FlightGlobals.GetBodyByName(name);
        }

        /// <summary>
        /// Fills in the target half of a state entry from the live target object.
        /// Every kind's own persisted fields, and RealAntennas' own display
        /// string, which is the same one its in-game "Antenna Target" field shows.
        /// </summary>
        private void DescribeTarget(RealAntennasAntennaState state, object? target)
        {
            if (target == null)
            {
                return;
            }
            state.TargetKind = _ra.TargetKind(target);
            state.TargetLabel = target.ToString();
            state.TargetVesselId = NullIfEmpty(_ra.TargetVesselId(target));
            state.TargetBodyName = NullIfEmpty(_ra.TargetBodyName(target));

            if (state.TargetKind == RaTargetPlan.ModeBodyLatLonAlt)
            {
                var (latitude, longitude, altitude) = _ra.TargetLatLonAlt(target);
                state.TargetLatitude = latitude;
                state.TargetLongitude = longitude;
                state.TargetAltitude = altitude;
                return;
            }
            state.TargetAzimuth = _ra.TargetAzimuth(target);
            state.TargetElevation = _ra.TargetElevation(target);
            state.TargetForward = _ra.TargetForward(target);
        }

        private static string? NullIfEmpty(string? value) => string.IsNullOrEmpty(value) ? null : value;
    }
}
