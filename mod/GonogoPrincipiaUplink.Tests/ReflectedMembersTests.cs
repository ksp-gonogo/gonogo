using System;
using System.Collections.Generic;
using Xunit;

namespace GonogoPrincipiaUplink.Tests
{
    /// <summary>The invoke allowlist, which is where the corrected safety rule is
    /// enforced rather than described.</summary>
    public class ReflectedMembersInvokeRuleTests
    {
        [Fact]
        public void RefusesToInvokeAMemberThatHasNotBeenAudited()
        {
            var ex = Assert.Throws<InvalidOperationException>(
                () => new ReflectedMembers().Invoke(new FakeFrameSelector(), "FrameParameters"));

            Assert.Contains("decompiled body", ex.Message);
        }

        [Fact]
        public void AllowsTheTwoAuditedMembers()
        {
            Assert.Equal(new[] { "Δv", "ok" }, ReflectedMembers.InvocableMembers);
        }

        /// <summary>
        /// A refusal must be a refusal, not a silent null: the whole point is that
        /// the mistake is invisible at the call site, so it has to be loud when
        /// reached.
        /// </summary>
        [Fact]
        public void TheRefusalIsAThrowRatherThanANull()
        {
            var selector = new FakeFrameSelector();

            Assert.Throws<InvalidOperationException>(
                () => new ReflectedMembers().Invoke(selector, "Name"));
            Assert.False(selector.AbortingMemberWasCalled);
        }
    }

    /// <summary>
    /// The property half of the same rule. Reading a property invokes its getter,
    /// so it is a call and belongs on the same footing as an explicit one.
    ///
    /// <para>Note what the other doubles could not have caught: they declare
    /// <c>frame_type</c> and <c>target_frame_selected</c> as FIELDS, while the
    /// producer is free to carry either as a property. A fixture that only ever
    /// presents the safe shape cannot fail on the dangerous one, so the double here
    /// exists to present a property specifically.</para>
    /// </summary>
    public class ReflectedMembersPropertyRuleTests
    {
        [Fact]
        public void RefusesToReadAPropertyWhoseGetterHasNotBeenRead()
        {
            var target = new FakePropertyBearer();

            var ex = Assert.Throws<InvalidOperationException>(
                () => new ReflectedMembers().Value(target, "AbortingProperty"));

            Assert.Contains("decompiled body", ex.Message);
            Assert.False(target.AbortingMemberWasCalled);
        }

        /// <summary>
        /// The refusal has to precede the read rather than catch it. Log.Fatal
        /// aborts the process instead of throwing, so a getter that reaches it never
        /// returns to a catch block at all.
        /// </summary>
        [Fact]
        public void TheGetterDoesNotRunAtAll()
        {
            var target = new FakePropertyBearer();

            Assert.Throws<InvalidOperationException>(
                () => new ReflectedMembers().ReadDouble(target, "AbortingProperty"));
            Assert.False(target.AbortingMemberWasCalled);
        }

        [Fact]
        public void AFieldReadNeverConsultsTheAllowlist()
        {
            Assert.Equal(
                7.0, new ReflectedMembers().ReadDouble(new FakePropertyBearer(), "plain_field_"));
        }

        [Fact]
        public void AnAllowlistedPropertyStillReads()
        {
            Assert.Equal(3, new ReflectedMembers().ReadCount(new FakePropertyBearer(), "items_"));
        }

        /// <summary>
        /// A STATIC member is still bound. The walk used to ask for instance members
        /// only, so every static setting on the producer resolved to no member and
        /// answered null, which a tolerant reader then reported as "could not be
        /// read" rather than as "was never looked for".
        /// </summary>
        [Fact]
        public void AStaticFieldIsFoundRatherThanSilentlyMissed()
        {
            Assert.Equal(
                11.0, new ReflectedMembers().ReadDouble(new FakePropertyBearer(), "static_field_"));
        }

        /// <summary>
        /// Static widens no permission: a static property is still a call and still
        /// has to be audited.
        /// </summary>
        [Fact]
        public void AStaticPropertyIsStillGuarded()
        {
            Assert.Throws<InvalidOperationException>(
                () => new ReflectedMembers().Value(new FakePropertyBearer(), "StaticAbortingProperty"));
        }

        /// <summary>
        /// Shrink-only, and now empty. A name leaves when its getter has been read
        /// or when it turns out never to have been a property at all; an addition
        /// means a property read shipped without an audit, so the exact contents are
        /// asserted rather than the count.
        /// </summary>
        [Fact]
        public void TheUnauditedListOnlyShrinks()
        {
            Assert.Empty(ReflectedMembers.UnauditedProperties);
        }
    }

    public class FakePropertyBearer
    {
#pragma warning disable CS0414, IDE0044, IDE1006
        private double plain_field_ = 7.0;
        private static readonly double static_field_ = 11.0;
        private HashSet<string> items_ = new HashSet<string> { "a", "b", "c" };
#pragma warning restore CS0414, CS0169, IDE0044, IDE1006

        public bool AbortingMemberWasCalled { get; private set; }

        /// <summary>Stands in for a getter that reaches Log.Fatal. The flag records
        /// that it ran at all, which is the thing the guard has to prevent.</summary>
        public double AbortingProperty
        {
            get
            {
                AbortingMemberWasCalled = true;
                throw new InvalidOperationException("Log.Fatal: Unexpected frame_type");
            }
        }

        public static double StaticAbortingProperty =>
            throw new InvalidOperationException("Log.Fatal: Unexpected type");
    }
}
