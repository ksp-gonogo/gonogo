import { describe, expect, it } from "vitest";
import { enumerateTopicFields } from "./topic-fields";
import {
  enumMembersOf,
  enumsForTopic,
  enumsForType,
  registerEnumMembers,
  registerTopicUnits,
  registerTypeUnits,
} from "./units";

describe("Uplink enum registration", () => {
  it("surfaces a registered Topic enum field with its member names", () => {
    registerEnumMembers("RegEnumsMode", { 0: "Off", 1: "On" });
    registerTopicUnits(
      "regenums.topic",
      { mode: "enum", name: "enum" },
      {},
      [],
      { mode: "RegEnumsMode", name: null },
    );

    expect(enumsForTopic("regenums.topic" as never)).toEqual({
      mode: "RegEnumsMode",
      name: null,
    });
    expect(enumMembersOf("RegEnumsMode")).toEqual({ 0: "Off", 1: "On" });

    const fields = enumerateTopicFields("regenums.topic");
    expect(fields.find((f) => f.path === "mode")?.enumEncoding).toEqual({
      by: "ordinal",
      names: { 0: "Off", 1: "On" },
    });
    expect(fields.find((f) => f.path === "name")?.enumEncoding).toEqual({
      by: "name",
    });
  });

  it("keeps the enums argument optional and resolves a registered type by name", () => {
    registerTypeUnits("RegEnumsPlain", { v: "m" });
    expect(enumsForType("RegEnumsPlain")).toEqual({});
    registerTypeUnits("RegEnumsTyped", { k: "enum" }, {}, [], { k: "Kind" });
    expect(enumsForType("RegEnumsTyped")).toEqual({ k: "Kind" });
  });
});
