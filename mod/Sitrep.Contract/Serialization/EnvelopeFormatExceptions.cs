using System;

namespace Sitrep.Contract.Serialization
{
    /// <summary>
    /// The frame's <c>type</c> discriminant is absent, unreadable, or names no
    /// envelope this build knows.
    ///
    /// <para>The two cases get different responses, which is what
    /// <see cref="EnvelopeType"/> tells apart. A frame with no readable type
    /// names nothing a server could refuse, and is echoed back, as the "is
    /// anything listening" probe expects. A frame that names a type this build
    /// does not support is refused by that name, because an echo of it would be
    /// byte-identical to the frame the client sent and read as a reply.</para>
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
    /// <para>Kept apart from <see cref="UnknownEnvelopeTypeException"/>
    /// because the two get opposite responses. Here the server knows which
    /// envelope it was handed and which field is wrong, so it refuses naming
    /// them; an echo would hand a command-request author back their own frame,
    /// which reads as a reply and hides the refusal completely.</para>
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
