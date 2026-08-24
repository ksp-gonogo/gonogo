using System;
using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// The <c>"controlFrame"</c> capability: whoever owns the game's navigation
    /// view says what frame it is in, and core resolves it without learning a
    /// name.
    ///
    /// <para><b>This one HAS a vanilla</b>, unlike the gravity-model election
    /// beside it, because stock genuinely answers the question: a stock map view
    /// really is body-centred with inertial axes, and every conic the game draws
    /// is drawn in it. That is a true answer rather than a stand-in, which is the
    /// test for whether a vanilla belongs at all.</para>
    ///
    /// <para>Names no mod. A source announces what it is through
    /// <see cref="ISitrepProvider.ProviderId"/> and nothing outside an election
    /// branches on the value.</para>
    /// </summary>
    public static class ControlFrameElection
    {
        /// <summary>
        /// The one declaration, taken from the contract rather than restated: a
        /// registering Uplink cannot compile against this file, so a literal here
        /// would be free to disagree with the one an Uplink writes, and the only
        /// symptom is a frame that never changes.
        /// </summary>
        public const string CapabilityId = ControlFrameCapability.Id;

        /// <summary>
        /// Declares the capability, with stock's own answer as the vanilla.
        /// Called at bootstrap, before any Uplink's <c>Register</c>, so a source
        /// can never race ahead of the declaration.
        ///
        /// <para>Not <see cref="CapabilityDescriptor.SpineCritical"/>: the stream
        /// is good without anyone knowing the view frame, and a widget that wanted
        /// to follow it simply resolves to nothing.</para>
        /// </summary>
        public static void RegisterCapability(
            Kernel kernel, Func<ProviderContext, IControlFrameSource> vanilla)
        {
            if (kernel == null) throw new ArgumentNullException(nameof(kernel));
            if (vanilla == null) throw new ArgumentNullException(nameof(vanilla));
            kernel.RegisterCapability(new CapabilityDescriptor
            {
                Id = CapabilityId,
                Exclusive = true,
                SpineCritical = false,
                Vanilla = ctx => vanilla(ctx),
            });
        }

        /// <summary>
        /// The elected source's frame, or null when nothing could read one.
        ///
        /// <para>Null covers both "no source answered" and "a source answered and
        /// could not tell", and the two do not need separating here: a client is
        /// told the same thing by both, because both mean nothing here knows what
        /// the player is looking at.</para>
        /// </summary>
        public static ControlFrame? Elected(Kernel? kernel)
        {
            if (kernel == null) return null;
            try
            {
                return kernel.Query<IControlFrameSource>(CapabilityId)?.Frame;
            }
            catch (Exception)
            {
                return null;
            }
        }
    }
}
