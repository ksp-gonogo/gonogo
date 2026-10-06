using System;

namespace Sitrep.Contract.Serialization
{
    /// <summary>
    /// The frame's <c>type</c> discriminant is absent, unreadable, or names no
    /// envelope this build knows.
    ///
    /// <para><see cref="EnvelopeType"/> tells the two cases apart, and the
    /// server responds to them differently. A frame with no readable type is echoed
    /// back unchanged, so a client can send any non-envelope text to check that
    /// the server is listening. A frame that names a type this build does not
    /// support is refused with an error naming that type.</para>
    /// <internal>
    /// The named case is refused rather than echoed because an echo would be
    /// byte-identical to the frame the client sent and would read as a reply.
    /// </internal>
    /// </summary>
    /// <category>Serialization</category>
    public class UnknownEnvelopeTypeException : FormatException
    {
        /// <summary>A frame with no readable type.</summary>
        /// <param name="message">What was wrong.</param>
        public UnknownEnvelopeTypeException(string message)
            : base(message)
        {
        }

        /// <summary>A frame with no readable type, caused by <paramref name="innerException"/>.</summary>
        /// <param name="message">What was wrong.</param>
        /// <param name="innerException">The parse failure behind it.</param>
        public UnknownEnvelopeTypeException(string message, Exception innerException)
            : base(message, innerException)
        {
        }

        /// <summary>A frame that names a type this build does not support.</summary>
        /// <param name="message">What was wrong.</param>
        /// <param name="envelopeType">The type the frame named.</param>
        /// <param name="requestId">The frame's <c>requestId</c>, or null when it carried no readable one.</param>
        /// <param name="topic">The frame's <c>topic</c>, or null when it carried no readable one.</param>
        public UnknownEnvelopeTypeException(string message, string envelopeType, string? requestId, string? topic)
            : base(message)
        {
            EnvelopeType = envelopeType;
            RequestId = requestId;
            Topic = topic;
        }

        /// <summary>The type the frame named, or null when it named none that could be read.</summary>
        public string? EnvelopeType { get; }

        /// <summary>The frame's <c>requestId</c> where it carried a readable one, so a refusal can be correlated.</summary>
        public string? RequestId { get; }

        /// <summary>The frame's <c>topic</c> where it carried a readable one, for the same reason.</summary>
        public string? Topic { get; }
    }

    /// <summary>
    /// The frame's type was recognised, and a required field inside it was
    /// missing or the wrong JSON type.
    ///
    /// <para>The server refuses such a frame with an error naming the envelope
    /// type and the field, and never echoes it, unlike a frame with no readable
    /// type (see <see cref="UnknownEnvelopeTypeException"/>).</para>
    /// <internal>
    /// An echo would hand a command-request author back their own frame, which
    /// reads as a reply and hides the refusal completely.
    /// </internal>
    /// </summary>
    /// <category>Serialization</category>
    public class InvalidEnvelopeException : FormatException
    {
        /// <summary>A recognised envelope with a missing or mistyped field.</summary>
        /// <param name="envelopeType">The <c>type</c> the frame carried.</param>
        /// <param name="requestId">The frame's <c>requestId</c>, or null when it has none or that field is the broken one.</param>
        /// <param name="innerException">The parse failure, whose message names the field.</param>
        public InvalidEnvelopeException(string envelopeType, string? requestId, Exception innerException)
            : base(envelopeType + " envelope rejected: " + innerException.Message, innerException)
        {
            EnvelopeType = envelopeType;
            RequestId = requestId;
        }

        /// <summary>The <c>type</c> the frame did carry, e.g. <c>command-request</c>.</summary>
        public string EnvelopeType { get; }

        /// <summary>
        /// The <c>requestId</c> read straight off the raw JSON where the frame
        /// carried a readable one, so a refusal can be correlated to the
        /// caller's pending command instead of being dropped. Null for the
        /// envelopes that have no such field, and for a command-request whose
        /// <c>requestId</c> is itself the broken part.
        /// </summary>
        public string? RequestId { get; }

        /// <summary>What was wrong, naming the field: the parser's own message.</summary>
        public string Detail => InnerException?.Message ?? Message;
    }
}
