using System;
using Sitrep.Contract;

namespace Sitrep.Host.Propagation
{
    /// <summary>
    /// The <c>"gravityModel"</c> capability: whoever knows what physics this
    /// install actually runs publishes the force model, and core resolves it
    /// without learning a name.
    ///
    /// <para><b>There is deliberately no vanilla.</b> Every other election here has
    /// one because stock KSP genuinely answers the question: stock physics IS
    /// two-body, stock CommNet IS a network. Stock has no n-body force model at
    /// all, so a vanilla would have to be assembled from per-body GMs and offered
    /// as the thing to integrate against, which produces a curve that agrees with
    /// nothing while looking exactly like one that does. Unsatisfied is the honest
    /// state, and it reaches a client as
    /// <see cref="TrajectoryRefusal.NoForceModel"/>: an install problem, said
    /// plainly.</para>
    ///
    /// <para>Names no mod, on the same rule <c>PropagationElection</c> states. A
    /// source announces what it is through <see cref="ISitrepProvider.ProviderId"/>
    /// and nothing outside an election branches on the value.</para>
    /// </summary>
    public static class GravityModelElection
    {
        /// <summary>
        /// The one declaration, taken from the contract rather than restated.
        /// A registering Uplink cannot compile against this file, so a literal here
        /// would be a copy free to disagree with the one an Uplink writes, and the
        /// only symptom of a disagreement is a curve that never arrives.
        /// </summary>
        public const string CapabilityId = GravityModelCapability.Id;

        /// <summary>
        /// Declares the capability. Called at bootstrap, before any Uplink's
        /// <c>Register</c>, so a source can never race ahead of the declaration.
        ///
        /// <para>Not <see cref="CapabilityDescriptor.SpineCritical"/>: the whole
        /// telemetry stream is good without an n-body force model, and an install
        /// that has none is the ordinary case rather than a fault.</para>
        /// </summary>
        public static void RegisterCapability(Kernel kernel)
        {
            if (kernel == null) throw new ArgumentNullException(nameof(kernel));
            kernel.RegisterCapability(new CapabilityDescriptor
            {
                Id = CapabilityId,
                Exclusive = true,
                SpineCritical = false,
                Vanilla = null,
            });
        }

        /// <summary>
        /// The elected source's model, or null when nothing published one.
        ///
        /// <para>Null covers both "no source registered" and "a source registered
        /// and could not read its configuration", and the two do not need
        /// separating here: a client is told the same thing by both, because both
        /// mean there is nothing to integrate against.</para>
        /// </summary>
        public static GravityModel? Model(Kernel? kernel)
        {
            if (kernel == null) return null;
            try
            {
                return kernel.Query<IGravityModelSource>(CapabilityId)?.Model;
            }
            catch (Exception)
            {
                return null;
            }
        }
    }
}
