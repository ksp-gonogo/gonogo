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
    // no I-prefix on ANY generated interface (AutoI(false) convention)
    expect(src).not.toMatch(/\binterface I[A-Z]/);
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
  it("emits the wire payload types, not just the envelope", () => {
    expect(src).toMatch(/export interface VesselOrbit\b/);
    expect(src).toMatch(/export interface VesselComms\b/);
    expect(src).toMatch(/export interface CommsConnectivity\b/);
    expect(src).toMatch(/export interface KosProcessorInfo\b/);
    expect(src).toMatch(/export interface Vec3\b/);
    // shared value shapes carry data only — no static factory methods leaked
    expect(src).toMatch(/export interface CommandResult\b/);
    expect(src).not.toMatch(/Ok\s*\(/);
    expect(src).not.toMatch(/Fail\s*\(/);
    // generic result renamed to avoid a TS2428 arity clash with its base
    expect(src).toMatch(
      /export interface CommandResultOf<T> extends CommandResult\b/,
    );
  });
  it("emits the wire enums", () => {
    expect(src).toMatch(/export enum CommandErrorCode \{/);
    expect(src).toMatch(/export enum VesselType \{/);
    expect(src).toMatch(/export enum Situation \{/);
    expect(src).toMatch(/export enum ControlState \{/);
  });
});
