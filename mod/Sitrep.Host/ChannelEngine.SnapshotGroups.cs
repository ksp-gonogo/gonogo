using System;
using System.Collections.Generic;
using System.Reflection;
using System.Threading;
using Sitrep.Contract;

namespace Sitrep.Host
{
    public sealed partial class ChannelEngine
    {
        /* Configured before Start and read on both threads after it. */
        private IReadOnlyDictionary<string, SnapshotGroupReaders>? _groupReaders;
        private Assembly? _coreAssembly;

        /// <summary>Main-thread-only: the groups the sample being taken leaves out.</summary>
        private string[]? _skippingNow;

        /// <summary>
        /// Written by the Courier after each tick's channels, read by the main thread:
        /// per group, the earliest UT a reader of it is next due, and the UT of the tick
        /// that worked that out.
        /// </summary>
        private volatile GroupsDue? _groupsDue;

        private sealed class GroupsDue
        {
            public GroupsDue(double asOfUt, Dictionary<string, double> dueUt)
            {
                AsOfUt = asOfUt;
                DueUt = dueUt;
            }

            public double AsOfUt { get; }

            public Dictionary<string, double> DueUt { get; }
        }

        /// <summary>Courier-thread-only: whether a channel's owning Uplink lives outside the core assemblies, by topic.</summary>
        private readonly Dictionary<string, bool> _channelIsExternal = new Dictionary<string, bool>(StringComparer.Ordinal);

        /// <summary>
        /// Names the snapshot groups a sample may leave out, and what reads each. A
        /// channel owned by an Uplink outside <paramref name="core"/> and this assembly
        /// counts as a reader of every group, since what it reads is not known. Called
        /// before <see cref="Start"/>; without it every sample builds every group.
        /// </summary>
        public void ConfigureSkippableGroups(IReadOnlyDictionary<string, SnapshotGroupReaders> readers, Assembly core)
        {
            _groupReaders = readers;
            _coreAssembly = core;
        }

        /// <summary>
        /// Main-thread: whether the sample being taken builds <paramref name="group"/>.
        /// True outside a sample, for a group that is not skippable, and on every
        /// sample that builds everything.
        /// </summary>
        public bool SamplesGroup(string group)
        {
            var skipping = _skippingNow;
            return skipping == null || Array.IndexOf(skipping, group) < 0;
        }

        /// <summary>
        /// Main-thread: the groups no reader is due for at <paramref name="ut"/>, by what
        /// the Courier last published, or null to build them all. A UT at or before the
        /// one that answer was worked out at (a stopped clock, a rewind) builds them all,
        /// as the cadence then calls every topic due.
        /// </summary>
        private string[]? GroupsToSkip(double ut)
        {
            var readers = _groupReaders;
            var due = _groupsDue;
            if (readers == null || due == null || double.IsNaN(ut) || !(ut > due.AsOfUt))
            {
                return null;
            }

            List<string>? skipped = null;
            foreach (var group in readers.Keys)
            {
                if (due.DueUt.TryGetValue(group, out var dueUt) && ut < dueUt)
                {
                    (skipped ??= new List<string>()).Add(group);
                    if (SampleTiming.Enabled)
                    {
                        SampleTiming.Count("skipped." + group, 1);
                    }
                }
            }
            return skipped?.ToArray();
        }

        /// <summary>Courier-thread-only: whether <paramref name="topic"/>'s channel reads any of <paramref name="groups"/>.</summary>
        private bool ReadsAnyOf(string topic, string[] groups)
        {
            var readers = _groupReaders;
            if (readers == null)
            {
                return false;
            }
            foreach (var group in groups)
            {
                if (ReadsGroup(topic, group, readers))
                {
                    return true;
                }
            }
            return false;
        }

        private bool ReadsGroup(string topic, string group, IReadOnlyDictionary<string, SnapshotGroupReaders> readers)
        {
            if (IsExternalChannel(topic))
            {
                return true;
            }
            if (!readers.TryGetValue(group, out var reader))
            {
                return false;
            }
            return reader.Topics.Contains(topic)
                || (_channelOwner.TryGetValue(topic, out var owner) && reader.Owners.Contains(owner));
        }

        private bool IsExternalChannel(string topic)
        {
            if (_channelIsExternal.TryGetValue(topic, out var known))
            {
                return known;
            }

            var external = false;
            if (_channelOwner.TryGetValue(topic, out var owner) && _registeredUplinks.TryGetValue(owner, out var uplink))
            {
                var assembly = uplink.GetType().Assembly;
                external = !ReferenceEquals(assembly, _coreAssembly) && !ReferenceEquals(assembly, typeof(ChannelEngine).Assembly);
            }
            _channelIsExternal[topic] = external;
            return external;
        }

        /// <summary>
        /// Courier-thread-only: after a tick's channels, the earliest UT each group's
        /// readers are next due at, for the main thread's next sample.
        /// </summary>
        private void PublishGroupsDue(double ut)
        {
            var readers = _groupReaders;
            if (readers == null)
            {
                return;
            }

            var due = new Dictionary<string, double>(StringComparer.Ordinal);
            foreach (var group in readers.Keys)
            {
                due[group] = double.PositiveInfinity;
            }
            foreach (var topic in _channelSources.Keys)
            {
                double? topicDue = null;
                foreach (var group in readers.Keys)
                {
                    if (!ReadsGroup(topic, group, readers))
                    {
                        continue;
                    }
                    topicDue ??= NextDueUt(topic);
                    if (topicDue.Value < due[group])
                    {
                        due[group] = topicDue.Value;
                    }
                }
            }
            _groupsDue = new GroupsDue(ut, due);
        }

        /// <summary>When the channel loop would next build <paramref name="topic"/>: by its cadence while read, on the warm interval while a Delayed topic is not, never otherwise.</summary>
        private double NextDueUt(string topic)
        {
            if (!IsChannelAvailable(topic))
            {
                return double.PositiveInfinity;
            }
            if (_subscriptions.IsSubscribed(topic))
            {
                return Cadence.NextDueUt(topic);
            }
            if (_channelDeclarations.TryGetValue(topic, out var declaration) && declaration.Delay == DelayRole.Delayed)
            {
                return _lastWarmUt.TryGetValue(topic, out var last) ? last + WarmIntervalUt : double.NegativeInfinity;
            }
            return double.PositiveInfinity;
        }


        /// <summary>Test-only: a tick whose sample left out <paramref name="skipped"/>, worked through before this returns.</summary>
        internal void TickSkippingAndWait(KspSnapshot snapshot, string[] skipped, TimeSpan timeout)
        {
            var barrier = new ManualResetEventSlim(false);
            var tick = CaptureTick(snapshot.Ut, snapshot, barrier);
            tick.SkippedGroups = skipped;
            EnqueueTick(tick);
            if (!barrier.Wait(timeout))
            {
                throw new TimeoutException("the skipping tick did not complete in time");
            }
        }

        /// <summary>Test-only: returns once the Courier has worked through every job queued before the call.</summary>
        internal void WaitForCourier(TimeSpan timeout)
        {
            var done = new ManualResetEventSlim(false);
            EnqueueJob(new CourierActionJob(done.Set));
            if (!done.Wait(timeout))
            {
                throw new TimeoutException("the Courier did not reach the marker in time");
            }
        }
    }
}
