export type RouterState = {
  preferredTier?: string;
  selectionSource?: string;
  hardBlockedTier?: string | null;
  hardBlockReason?: string | null;
};

export type SessionCompactingInput = {
  context?: Record<string, unknown>;
  sessionID?: string;
};

export type SessionCompactingOutput = {
  context?: unknown;
};

export type SessionCompactingPayload = {
  input: SessionCompactingInput;
  output: SessionCompactingOutput;
};

export type ShellEnvPayload = {
  env: Record<string, string>;
  conversationSettings?: {
    systemPrompt?: unknown;
  };
};

export type ShellEnvResult = {
  env: Record<string, string>;
};
