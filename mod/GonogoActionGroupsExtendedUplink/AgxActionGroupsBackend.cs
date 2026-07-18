using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Host.ActionGroups;

namespace Gonogo.ActionGroupsExtendedUplink
{
    /// <summary>
    /// The AGX <see cref="IActionGroupsBackend"/> — the higher-priority
    /// backend elected for the exclusive <c>"actionGroups"</c> capability
    /// when AGExt is loaded
    /// (docs/superpowers/specs/2026-07-17-agx-backend-design.md §5.3).
    /// Produces the SAME <see cref="ActionGroupState"/> the stock backend
    /// produces — no new wire type, no contract change — just a longer,
    /// player-named list sourced from AGX instead of stock's ten anonymous
    /// customs.
    ///
    /// <para>Main-thread only, same as
    /// <see cref="Gonogo.KSP.StockActionGroupsBackend"/>: called from the
    /// vessel uplink's main-thread capture and the FixedUpdate-drained
    /// command queue, never a Courier-thread channel closure.</para>
    /// </summary>
    public sealed class AgxActionGroupsBackend : IActionGroupsBackend
    {
        private readonly IAgxApi _agx;

        public AgxActionGroupsBackend(IAgxApi agx) => _agx = agx;

        public IList<ActionGroupState>? Groups()
        {
            var assigned = _agx.AssignedGroups();
            if (assigned == null)
            {
                // Null, NOT empty — same "no data this tick" contract as
                // StockActionGroupsBackend.Groups().
                return null;
            }

            var list = new List<ActionGroupState>(assigned.Count);
            foreach (var g in assigned.OrderBy(g => g.Index))
            {
                list.Add(new ActionGroupState
                {
                    Index = g.Index,
                    // AGExt lets an assigned group go unnamed; fall back to
                    // the same "AG{n}" label the stock backend uses so the
                    // client stays visually consistent either way.
                    Name = g.Name ?? ("AG" + g.Index),
                    State = g.State,
                });
            }
            return list;
        }

        public bool SetGroup(int index, bool state) =>
            // AGExt's own success bool IS the range check — an index AGExt
            // rejects becomes false here, which VesselCommandProvider turns
            // into CommandErrorCode.Range, exactly the seam's design. The
            // backend owns the range because only the backend knows it.
            _agx.Activate(index, state);
    }
}
