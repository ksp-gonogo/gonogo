using CommNet;
using Sitrep.Host.CommandCentres;
using UnityEngine;

namespace Gonogo.KSP.CommandCentres
{
    // NOTE (agent-6, Plan 3): this worktree has no KspManaged reference DLLs, so
    // the files under Gonogo.KSP/CommandCentres/ cannot be compiled locally. The
    // KSP member accesses (CommNetHome.comm / .isKSC / .nodeName / .body,
    // CommNode.isControlSource / .precisePosition, Vessel.connection.Comm) are
    // written from agent-2's command-centre-sources research + the existing
    // CommNetBackend.cs usage; verify member names at the full-sln fold.

    /// <summary>
    /// A concrete KSP-backed <see cref="ICommandCentre"/>. It exposes the KSP-free
    /// identity view (id, name, kind, body) AND carries the CommNet routing data
    /// (<see cref="Node"/> / <see cref="Position"/>) that the authority routeDelay
    /// downcasts to. Sources build these fresh each enumeration pass, so
    /// <see cref="IsActiveNow"/> returns the active state captured at enumeration.
    /// </summary>
    internal sealed class KspCommandCentre : ICommandCentre
    {
        private readonly bool _active;

        public KspCommandCentre(
            string id,
            string displayName,
            CommandCentreKind kind,
            int? bodyIndex,
            CommNode node,
            Vector3d position,
            bool active)
        {
            Id = id;
            DisplayName = displayName;
            Kind = kind;
            BodyIndex = bodyIndex;
            Node = node;
            Position = position;
            _active = active;
        }

        public string Id { get; }
        public string DisplayName { get; }
        public CommandCentreKind Kind { get; }
        public int? BodyIndex { get; }

        /// <summary>The CommNet node for routed (ControlPath) delay; may be null (then use <see cref="Position"/>). Not on the KSP-free interface.</summary>
        public CommNode Node { get; }

        /// <summary>Straight-line-geometry fallback position when <see cref="Node"/> is null.</summary>
        public Vector3d Position { get; }

        public bool IsActiveNow() => _active;
    }
}
