using System;
using System.Collections.Generic;
using Sitrep.Core;
using Sitrep.Host;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// A minimal <see cref="IExtensionHost"/> test double that only records
    /// <see cref="ForceKeyframe"/> (and, optionally, <see cref="ResetChannelBirth"/>)
    /// calls — used to unit-test <see cref="VesselEpochSampler"/> (and any
    /// future sampler/handler that only needs those two) in isolation,
    /// without spinning up a real <see cref="ChannelEngine"/>. Every other
    /// member either no-ops or throws <see cref="NotSupportedException"/> —
    /// a test that starts needing one of them should extend this double
    /// deliberately, not silently rely on a guessed default.
    /// </summary>
    internal sealed class FakeExtensionHost : IExtensionHost
    {
        private readonly Action<string> _onForceKeyframe;
        private readonly Action<IEnumerable<string>> _onResetChannelBirth;

        /// <param name="onResetChannelBirth">
        /// Optional -- defaults to a no-op so every PRE-EXISTING call site
        /// (which only ever cared about <see cref="ForceKeyframe"/>) keeps
        /// compiling and behaving identically now that
        /// <see cref="VesselEpochSampler"/> ALSO calls
        /// <see cref="ResetChannelBirth"/> on every subject switch. Pass a
        /// callback to assert on it, matching <paramref name="onForceKeyframe"/>'s
        /// shape.
        /// </param>
        public FakeExtensionHost(Action<string> onForceKeyframe, Action<IEnumerable<string>>? onResetChannelBirth = null)
        {
            _onForceKeyframe = onForceKeyframe;
            _onResetChannelBirth = onResetChannelBirth ?? (_ => { });
        }

        public double NowUt() => 0.0;

        public void AddSampler(ISnapshotSampler sampler)
        {
        }

        public void AddChannelSource(string topic, Func<KspSnapshot?, object?> map)
        {
        }

        public IChannelPublisher Publisher(string topic) => throw new NotSupportedException();

        public void AddCommandHandler<TArgs, TResult>(string command, Func<TArgs, TResult> handler)
        {
        }

        public Kernel Kernel => throw new NotSupportedException();

        public void SetAvailability(Availability availability)
        {
        }

        public void ForceKeyframe(string topic) => _onForceKeyframe(topic);

        public void ResetChannelBirth(IEnumerable<string> topics) => _onResetChannelBirth(topics);
    }
}
