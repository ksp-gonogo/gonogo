using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Sitrep.Core.Serialization
{
    /// <summary>
    /// Hand-written recursive-descent JSON parser — no Json.NET, no
    /// System.Text.Json (see <see cref="JsonWriter"/> for why). Parses into
    /// the same generic CLR value shape <see cref="JsonWriter.AppendValue"/>
    /// writes: <c>null</c>, <c>bool</c>, <c>double</c>, <c>string</c>,
    /// <c>Dictionary&lt;string, object?&gt;</c>, <c>List&lt;object?&gt;</c>.
    ///
    /// THE only place a JSON string VALUE (not an object key) is converted
    /// to a CLR value — every string token is checked against
    /// <see cref="NanPolicy.TryDecode"/> and, if it matches, decoded straight
    /// to the corresponding non-finite <c>double</c> instead of staying a
    /// string. Applied uniformly regardless of nesting depth, symmetric with
    /// <see cref="JsonWriter.AppendNumber"/> on the write side — so by the
    /// time <c>EnvelopeCodec</c> reads a field out of the parsed tree
    /// (<c>Meta.ValidAt</c>, a <c>Payload</c> entry, anything), the sentinel
    /// has already round-tripped back to a real <c>double</c> and no
    /// per-field special-casing is needed there.
    /// </summary>
    internal static class JsonReader
    {
        public static object? Parse(string json)
        {
            var parser = new Parser(json);
            parser.SkipWhitespace();
            var value = parser.ParseValue();
            parser.SkipWhitespace();
            if (!parser.AtEnd)
            {
                throw new FormatException($"Unexpected trailing content at position {parser.Position} in JSON: {json}");
            }
            return value;
        }

        private ref struct Parser
        {
            private readonly string _s;
            private int _i;

            public Parser(string s)
            {
                _s = s;
                _i = 0;
            }

            public int Position => _i;
            public bool AtEnd => _i >= _s.Length;

            public void SkipWhitespace()
            {
                while (_i < _s.Length)
                {
                    var c = _s[_i];
                    if (c == ' ' || c == '\t' || c == '\n' || c == '\r')
                    {
                        _i++;
                    }
                    else
                    {
                        break;
                    }
                }
            }

            private char Peek()
            {
                if (_i >= _s.Length)
                {
                    throw new FormatException($"Unexpected end of JSON at position {_i}.");
                }
                return _s[_i];
            }

            private void Expect(char c)
            {
                if (Peek() != c)
                {
                    throw new FormatException($"Expected '{c}' at position {_i} but found '{Peek()}'.");
                }
                _i++;
            }

            private void ExpectLiteral(string literal)
            {
                if (_i + literal.Length > _s.Length || _s.Substring(_i, literal.Length) != literal)
                {
                    throw new FormatException($"Expected literal \"{literal}\" at position {_i}.");
                }
                _i += literal.Length;
            }

            public object? ParseValue()
            {
                SkipWhitespace();
                var c = Peek();
                switch (c)
                {
                    case '{':
                        return ParseObject();
                    case '[':
                        return ParseArray();
                    case '"':
                        return ParseStringValue();
                    case 't':
                        ExpectLiteral("true");
                        return true;
                    case 'f':
                        ExpectLiteral("false");
                        return false;
                    case 'n':
                        ExpectLiteral("null");
                        return null;
                    default:
                        return ParseNumber();
                }
            }

            private Dictionary<string, object?> ParseObject()
            {
                Expect('{');
                var result = new Dictionary<string, object?>();
                SkipWhitespace();
                if (Peek() == '}')
                {
                    _i++;
                    return result;
                }

                while (true)
                {
                    SkipWhitespace();
                    var key = ParseRawString();
                    SkipWhitespace();
                    Expect(':');
                    var value = ParseValue();
                    result[key] = value;

                    SkipWhitespace();
                    var next = Peek();
                    if (next == ',')
                    {
                        _i++;
                        continue;
                    }
                    Expect('}');
                    break;
                }

                return result;
            }

            private List<object?> ParseArray()
            {
                Expect('[');
                var result = new List<object?>();
                SkipWhitespace();
                if (Peek() == ']')
                {
                    _i++;
                    return result;
                }

                while (true)
                {
                    var value = ParseValue();
                    result.Add(value);

                    SkipWhitespace();
                    var next = Peek();
                    if (next == ',')
                    {
                        _i++;
                        continue;
                    }
                    Expect(']');
                    break;
                }

                return result;
            }

            /// <summary>Parses a JSON string VALUE and applies the NaN/Infinity sentinel decode. Use <see cref="ParseRawString"/> for object keys.</summary>
            private object ParseStringValue()
            {
                var raw = ParseRawString();
                return NanPolicy.TryDecode(raw, out var d) ? (object)d : raw;
            }

            private string ParseRawString()
            {
                Expect('"');
                var sb = new StringBuilder();
                while (true)
                {
                    if (_i >= _s.Length)
                    {
                        throw new FormatException("Unterminated JSON string.");
                    }
                    var c = _s[_i++];
                    if (c == '"')
                    {
                        break;
                    }
                    if (c == '\\')
                    {
                        if (_i >= _s.Length)
                        {
                            throw new FormatException("Unterminated JSON string escape.");
                        }
                        var esc = _s[_i++];
                        switch (esc)
                        {
                            case '"':
                                sb.Append('"');
                                break;
                            case '\\':
                                sb.Append('\\');
                                break;
                            case '/':
                                sb.Append('/');
                                break;
                            case 'b':
                                sb.Append('\b');
                                break;
                            case 'f':
                                sb.Append('\f');
                                break;
                            case 'n':
                                sb.Append('\n');
                                break;
                            case 'r':
                                sb.Append('\r');
                                break;
                            case 't':
                                sb.Append('\t');
                                break;
                            case 'u':
                                if (_i + 4 > _s.Length)
                                {
                                    throw new FormatException("Truncated \\u escape in JSON string.");
                                }
                                var hex = _s.Substring(_i, 4);
                                sb.Append((char)ushort.Parse(hex, NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                                _i += 4;
                                break;
                            default:
                                throw new FormatException($"Unknown escape '\\{esc}' in JSON string.");
                        }
                    }
                    else
                    {
                        sb.Append(c);
                    }
                }
                return sb.ToString();
            }

            private double ParseNumber()
            {
                var start = _i;
                if (_i < _s.Length && _s[_i] == '-')
                {
                    _i++;
                }
                while (_i < _s.Length && char.IsDigit(_s[_i]))
                {
                    _i++;
                }
                if (_i < _s.Length && _s[_i] == '.')
                {
                    _i++;
                    while (_i < _s.Length && char.IsDigit(_s[_i]))
                    {
                        _i++;
                    }
                }
                if (_i < _s.Length && (_s[_i] == 'e' || _s[_i] == 'E'))
                {
                    _i++;
                    if (_i < _s.Length && (_s[_i] == '+' || _s[_i] == '-'))
                    {
                        _i++;
                    }
                    while (_i < _s.Length && char.IsDigit(_s[_i]))
                    {
                        _i++;
                    }
                }

                if (_i == start)
                {
                    throw new FormatException($"Expected a JSON value at position {start} but found '{Peek()}'.");
                }

                var token = _s.Substring(start, _i - start);
                return double.Parse(token, NumberStyles.Float, CultureInfo.InvariantCulture);
            }
        }
    }
}
