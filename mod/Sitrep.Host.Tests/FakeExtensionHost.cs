using System;
using Sitrep.Core;
using Sitrep.Host;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// A minimal <see cref="IExtensionHost"/> test double that only records
    /// <see cref="ForceKeyframe"/> calls — used to unit-test
    /// <see cref="VesselEpochSampler"/> (and any future sampler/handler that
    /// only needs that one call) in isolation, without spinning up a real
    /// <see cref="ChannelEngine"/>. Every other member either no-ops or
    /// throws <see cref="NotSupportedException"/> — a test that starts
    /// needing one of them should extend this double deliberately, not
    /// silently rely on a guessed default.
    /// </summary>
    internal sealed class FakeExtensionHost : IExtensionHost
    {
        private readonly Action<string> _onForceKeyframe;

        public FakeExtensionHost(Action<string> onForceKeyframe)
        {
            _onForceKeyframe = onForceKeyframe;
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
    }
}
