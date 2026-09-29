using System;
using System.Collections.Generic;

namespace Sitrep.Contract.TestSupport
{
    /// <summary>
    /// The delay modifiers an Uplink holds on a test host, so a test can ask what
    /// factor is in force and why. Registration refuses exactly what the real host
    /// refuses; a disposed handle leaves the list.
    /// </summary>
    public sealed class HeldDelayModifiers
    {
        private readonly List<HeldDelayModifier> _held = new List<HeldDelayModifier>();

        /// <summary>Every modifier held now, in the order it was registered.</summary>
        public IReadOnlyList<HeldDelayModifier> Held => _held;

        /// <summary>The product of every held factor; 1 when none is held.</summary>
        public double Product
        {
            get
            {
                var product = 1.0;
                foreach (var modifier in _held)
                {
                    product *= modifier.Factor;
                }
                return product;
            }
        }

        /// <summary>What <see cref="IUplinkHost.RegisterDelayModifier"/> does on the real host.</summary>
        public IDisposable Register(double factor, string reason)
        {
            if (double.IsNaN(factor) || double.IsInfinity(factor) || factor < 0.0)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(factor), factor, "a delay factor is zero or a positive, finite number");
            }
            if (string.IsNullOrWhiteSpace(reason))
            {
                throw new ArgumentException("a delay modifier says why it is held", nameof(reason));
            }

            var modifier = new HeldDelayModifier(this, factor, reason);
            _held.Add(modifier);
            return modifier;
        }

        internal void Withdraw(HeldDelayModifier modifier) => _held.Remove(modifier);
    }

    /// <summary>One modifier held on a test host.</summary>
    public sealed class HeldDelayModifier : IDisposable
    {
        private readonly HeldDelayModifiers _owner;

        internal HeldDelayModifier(HeldDelayModifiers owner, double factor, string reason)
        {
            _owner = owner;
            Factor = factor;
            Reason = reason;
        }

        /// <summary>The factor held.</summary>
        public double Factor { get; }

        /// <summary>The reason given for it.</summary>
        public string Reason { get; }

        /// <summary>Withdraw the modifier. Disposing twice is harmless.</summary>
        public void Dispose() => _owner.Withdraw(this);
    }
}
