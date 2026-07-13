// Gonogo.Kos — GPLv3. See Gonogo.Kos.csproj's header comment for the
// licence/linkage rationale.

using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Gonogo.Kos
{
    /// <summary>
    /// Pure, KSP/kOS-free bookkeeping for the <c>kos.run</c> command's
    /// request/response correlation — see <c>kos-uplink-full-migration.md</c>.
    /// A kOS CPU's interpreter is a single-threaded REPL (only one command
    /// can be "in flight" at a time, guarded by <c>IsWaitingForCommand()</c>
    /// at the KSP-touching call site), so this only ever needs to track ONE
    /// armed request per CPU, not a general request table.
    ///
    /// <para><b>Wiring:</b> the KSP-touching <c>Run(KosRunArgs)</c> command
    /// handler (<c>KosExtension.Ksp.cs</c>) calls <see cref="TryArm"/> after
    /// confirming the CPU is idle and before typing the command; the
    /// KSP-free <c>KosExtension.OnPrint</c> — already resolving the emitting
    /// CPU once per completed <see cref="KosComputeBlock"/>, for the
    /// <c>kos.compute.*</c> fanout — routes a completed block to
    /// <see cref="Complete"/> instead of the compute fanout whenever
    /// <see cref="IsArmed"/> is true for that CPU. This class never touches
    /// a kOS/Unity type directly, so it is fully unit-testable headlessly
    /// (mirrors <c>KosTerminalManager</c>'s KSP-free/KSP-touching split).</para>
    ///
    /// <para><b>Known gap (documented, not fixed here):</b> no timeout/
    /// eviction of a stale armed request (a CPU reboot/unload/crash mid-run
    /// leaves it armed forever, wedging every later <c>kos.run</c> to that
    /// CPU). See the migration plan's "Risks" section — a <c>Poll</c>-driven
    /// expiry (mirroring <c>KosTerminalManager.Poll</c>) is main-tree
    /// follow-up work.</para>
    /// </summary>
    public sealed class KosRunManager
    {
        // coreId -> the single armed request's RequestId. Presence in this
        // dictionary IS "armed" — there is no separate flag.
        private readonly Dictionary<int, string> _pending = new Dictionary<int, string>();

        private Action<int, KosRunResult>? _publish;

        /// <summary>
        /// Wire the publish sink — called once from
        /// <c>KosExtension.Ksp.cs</c>'s <c>RegisterKspBindings</c> with a
        /// delegate that publishes onto <c>kos.run.&lt;coreId&gt;</c>. Tests
        /// wire their own recording delegate directly, bypassing
        /// <c>KosExtension</c> entirely — this class needs no KosExtension
        /// instance to be tested.
        /// </summary>
        public void SetPublisher(Action<int, KosRunResult> publish) => _publish = publish;

        /// <summary>
        /// Arm a pending run for <paramref name="coreId"/>. Returns false —
        /// caller should reject the command (mirrors <c>ModeUnavailable</c>,
        /// the same "reject, never silently clobber" posture as
        /// <c>KosTerminalManager.Open</c>'s lease conflict) — when a run is
        /// already in flight for this CPU, or <paramref name="requestId"/> is
        /// empty. The client's own per-CPU FIFO queue (mirroring
        /// <c>KosComputeSession</c>) is expected to prevent this in the
        /// steady state.
        /// </summary>
        public bool TryArm(int coreId, string requestId)
        {
            if (string.IsNullOrEmpty(requestId))
            {
                return false;
            }
            if (_pending.ContainsKey(coreId))
            {
                return false;
            }
            _pending[coreId] = requestId;
            return true;
        }

        /// <summary>True while a run is armed (in flight) for <paramref name="coreId"/>.</summary>
        public bool IsArmed(int coreId) => _pending.ContainsKey(coreId);

        /// <summary>True while ANY CPU has an armed run — widens OnPrint's subscription gate so accumulation isn't starved when nobody subscribes to kos.compute.* (see the migration plan's "Subscription-gate fix").</summary>
        public bool HasAnyArmed() => _pending.Count > 0;

        /// <summary>
        /// Called when a <see cref="KosComputeBlock"/> completes for
        /// <paramref name="coreId"/>'s screen while a run is armed for that
        /// CPU (caller must check <see cref="IsArmed"/> first — this is a
        /// no-op, not an error, when nothing is armed, so a stray completed
        /// block after eviction/cancellation is harmless). Publishes the
        /// correlated <see cref="KosRunResult"/> and disarms.
        /// </summary>
        public void Complete(int coreId, KosComputeBlock block)
        {
            if (!_pending.TryGetValue(coreId, out var requestId))
            {
                return;
            }
            _pending.Remove(coreId);

            var result = new KosRunResult
            {
                CoreId = coreId,
                RequestId = requestId,
                Fields = block.IsError ? null : ToFieldMap(block.Fields),
                Error = block.IsError ? block.ErrorMessage : null,
            };
            _publish?.Invoke(coreId, result);
        }

        /// <summary>
        /// Disarm <paramref name="coreId"/> WITHOUT publishing — for a CPU
        /// going away (reboot/unload) mid-run, so a later unrelated block
        /// from a freshly-booted CPU with the same id isn't mis-attributed
        /// to the abandoned request. Not currently called from
        /// <c>KosExtension</c> (see the migration plan's known gaps) —
        /// exposed for the main-tree follow-up to wire in.
        /// </summary>
        public void Cancel(int coreId) => _pending.Remove(coreId);

        private static Dictionary<string, object?> ToFieldMap(IReadOnlyDictionary<string, object> fields)
        {
            var map = new Dictionary<string, object?>(fields.Count);
            foreach (var kv in fields)
            {
                map[kv.Key] = kv.Value;
            }
            return map;
        }
    }
}
