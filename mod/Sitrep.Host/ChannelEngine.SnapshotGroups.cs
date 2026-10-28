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

        /// <summary>Main-thread-only: whether the sample being taken builds everything; true outside a sample.</summary>
        private bool _sampleIsFull = true;

        /// <summary>Main-thread-only: the groups the sample being taken handed on from an earlier one.</summary>
        private List<string>? _reusedNow;

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
        /// Main-thread: whether the sample being taken builds every group afresh, as a
        /// requested sample and a recording session do. A group kept between samples is
        /// built again on one. True outside a sample.
        /// </summary>
        public bool IsFullSample => _sampleIsFull;

        /// <summary>
        /// Main-thread, during a sample: <paramref name="group"/> was handed on from an
        /// earlier sample rather than built. Its declared readers are not built from this
        /// tick and each waits for the tick that builds it, whose UT it then carries.
        /// Anything owned by an Uplink outside the core (a channel, a capture, a sampler)
        /// runs as usual and finds the group absent, as it finds a skipped one.
        /// </summary>
        public void NoteGroupReused(string group)
        {
            (_reusedNow ??= new List<string>()).Add(group);
            if (SampleTiming.Enabled)
            {
                SampleTiming.Count("reused." + group, 1);
            }
        }

        private string[]? TakeReused()
        {
            var reused = _reusedNow;
            _reusedNow = null;
            return reused?.ToArray();
        }

        /// <summary>Main-thread-only, while a tick's captures run: the groups its sample handed on.</summary>
        private string[]? _reusedForCaptures;

        /// <summary>Main-thread: the snapshot a capture is handed, without the reused groups when an Uplink outside the core owns it.</summary>
        private KspSnapshot? CaptureViewFor(string ownerId, KspSnapshot? snapshot)
        {
            var reused = _reusedForCaptures;
            return reused == null || snapshot == null || !IsExternalOwner(ownerId) ? snapshot : WithoutGroups(snapshot, reused);
        }

        /// <summary>Courier-thread-only: the snapshot a channel is mapped from, without the reused groups for one owned outside the core.</summary>
        private KspSnapshot? ChannelViewFor(string topic, TickJob tick)
        {
            if (tick.ReusedGroups == null || tick.Snapshot == null || !IsExternalChannel(topic))
            {
                return tick.Snapshot;
            }
            return tick.WithoutReused ??= WithoutGroups(tick.Snapshot, tick.ReusedGroups);
        }

        /*
         * A sampler adds its own data to the snapshot, so one outside the core is handed
         * a copy without the reused groups and what it added is carried back.
         */
        private void SampleWithoutReused(string ownerId, ISnapshotSampler sampler, TickJob tick)
        {
            if (tick.ReusedGroups == null || tick.Snapshot == null || !IsExternalOwner(ownerId))
            {
                sampler.Sample(tick.Snapshot!);
                return;
            }

            var view = WithoutGroups(tick.Snapshot, tick.ReusedGroups);
            sampler.Sample(view);
            foreach (var pair in view.Values)
            {
                if (Array.IndexOf(tick.ReusedGroups, pair.Key) < 0
                    && (!tick.Snapshot.Values.TryGetValue(pair.Key, out var had) || !ReferenceEquals(had, pair.Value)))
                {
                    tick.Snapshot.Values[pair.Key] = pair.Value;
                }
            }
            tick.WithoutReused = null;
        }

        /// <summary>
        /// A copy of <paramref name="snapshot"/> with <paramref name="groups"/> left out,
        /// at the top level and inside the <c>vessel</c> group, sharing every other value.
        /// </summary>
        internal static KspSnapshot WithoutGroups(KspSnapshot snapshot, string[] groups)
        {
            var values = new Dictionary<string, object?>(snapshot.Values);
            foreach (var group in groups)
            {
                values.Remove(group);
            }
            if (values.TryGetValue("vessel", out var raw) && raw is Dictionary<string, object?> vessel)
            {
                Dictionary<string, object?>? trimmed = null;
                foreach (var group in groups)
                {
                    if (vessel.ContainsKey(group))
                    {
                        (trimmed ??= new Dictionary<string, object?>(vessel)).Remove(group);
                    }
                }
                if (trimmed != null)
                {
                    values["vessel"] = trimmed;
                }
            }
            return new KspSnapshot { Ut = snapshot.Ut, Values = values };
        }

        /// <summary>Courier-thread-only: whether <paramref name="topic"/>'s channel is one of the declared readers of any of <paramref name="groups"/>.</summary>
        private bool DeclaredReaderOfAny(string topic, string[] groups)
        {
            var readers = _groupReaders;
            if (readers == null)
            {
                return false;
            }
            foreach (var group in groups)
            {
                if (readers.TryGetValue(group, out var reader)
                    && (reader.Topics.Contains(topic)
                        || (_channelOwner.TryGetValue(topic, out var owner) && reader.Owners.Contains(owner))))
                {
                    return true;
                }
            }
            return false;
        }

        /// <summary>Whether the Uplink <paramref name="ownerId"/> lives outside the core assemblies. Registration ends before Start, so either thread may ask.</summary>
        private bool IsExternalOwner(string ownerId)
        {
            if (_groupReaders == null || !_registeredUplinks.TryGetValue(ownerId, out var uplink))
            {
                return false;
            }
            var assembly = uplink.GetType().Assembly;
            return !ReferenceEquals(assembly, _coreAssembly) && !ReferenceEquals(assembly, typeof(ChannelEngine).Assembly);
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

            var external = _channelOwner.TryGetValue(topic, out var owner) && IsExternalOwner(owner);
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
