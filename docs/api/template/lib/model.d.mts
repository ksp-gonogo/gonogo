export type Frame = Record<string, unknown>;

export interface ChannelEntry {
  kind: "telemetry" | "command";
  address: string;
  description: string;
  attributes: Record<string, unknown>;
  payload: unknown;
  result?: unknown;
  acknowledged?: boolean;
  frame: Frame;
  example?: Frame;
}

export interface SessionFrame {
  type: string;
  schemaName: string;
  title: string;
  direction: "client" | "mod";
  payload: unknown;
  frame: Frame | undefined;
}

export interface ApiModel {
  title: string;
  version: string;
  description: string;
  session: {
    description: string;
    sent: SessionFrame[];
    received: SessionFrame[];
  };
  frames: SessionFrame[];
  namespaces: { name: string; description: string; channels: ChannelEntry[] }[];
}

export function buildModel(doc: Record<string, unknown>): ApiModel;
