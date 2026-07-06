import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(
  fileURLToPath(new URL("./__generated__/contract.ts", import.meta.url)),
  "utf8",
);

describe("generated contract.ts", () => {
  it("is an ES module (export, no `module` wrapper)", () => {
    expect(src).toMatch(/export interface StreamData<T>/);
    expect(src).not.toMatch(/^\s*module /m);
    // no I-prefix on any generated interfaces
    expect(src).not.toMatch(/interface IStreamData/);
    expect(src).not.toMatch(/interface IMeta/);
    expect(src).not.toMatch(/interface ICommandResponse/);
  });
  it("has camelCase properties", () => {
    expect(src).toMatch(/validAt:\s*number/);
    expect(src).toMatch(/deliveredAt:\s*number/);
  });
  it("keeps all 7 literal-narrowed discriminants", () => {
    expect(src).toMatch(/type:\s*"stream-data"/);
    expect(src).toMatch(/type:\s*"event"/);
    expect(src).toMatch(/type:\s*"command-request"/);
    expect(src).toMatch(/type:\s*"command-response"/);
    expect(src).toMatch(/type:\s*"error"/);
    expect(src).toMatch(/type:\s*"subscribe"/);
    expect(src).toMatch(/type:\s*"unsubscribe"/);
  });
  it("emits all generics", () => {
    expect(src).toMatch(/export interface CommandRequest<TArgs>/);
    expect(src).toMatch(/export interface CommandResponse<TResult>/);
    expect(src).toMatch(/export interface StreamData<T>/);
  });
  it("emits optional properties", () => {
    expect(src).toMatch(/requestId\?:/);
    expect(src).toMatch(/confidence\?:/);
  });
});
