using System;

namespace Sitrep.Contract.Serialization
{
    /// <summary>
    /// The frame's <c>type</c> discriminant is absent, unreadable, or names no
    /// envelope this build knows.
    ///
    /// <para>The two halves want different answers, which is what
    /// <see cref="EnvelopeType"/> tells apart. A frame with no readable type
    /// says nothing a server could name, and is echoed back as the "is anything
    /// listening" probe. A frame that NAMES a type this build does not support
    /// is refused by that name, because an echo of it is byte-identical to the
    /// frame the client sent and reads as a reply.</para>
    /// </summary>
    public class UnknownEnvelopeTypeException : FormatException
    {
        public UnknownEnvelopeTypeException(string message)
            : base(message)
        {
        }

        public UnknownEnvelopeTypeException(string message, Exception innerException)
            : base(message, innerException)
        {
        }

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
    /// The frame's type WAS recognised and a required field inside it was
    /// missing or the wrong JSON type.
    ///
    /// <para>Held apart from <see cref="UnknownEnvelopeTypeException"/> because
    /// the two want opposite answers. Here the server knows exactly which
    /// envelope it was handed and exactly which field is wrong, so it says so;
    /// echoing instead hands a command-request author back their own frame,
    /// which reads as a reply and hides the refusal completely.</para>
    /// </summary>
    public class InvalidEnvelopeException : FormatException
    {
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
