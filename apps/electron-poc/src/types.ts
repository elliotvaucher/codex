export type RequestId = number | string;

export interface JsonRpcRequest {
  id: RequestId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  id: RequestId;
  result: unknown;
}

export interface JsonRpcError {
  id: RequestId;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcMessage =
  | { kind: "request"; request: JsonRpcRequest }
  | { kind: "notification"; notification: JsonRpcNotification }
  | { kind: "response"; response: JsonRpcResponse }
  | { kind: "error"; error: JsonRpcError };

export interface InitializeParams {
  clientInfo: {
    name: string;
    version: string;
    title?: string;
  };
}

export type AskForApproval = "unless-trusted" | "on-failure" | "on-request" | "never";

export type SandboxPolicy =
  | { mode: "read-only" }
  | { mode: "danger-full-access" }
  | {
      mode: "workspace-write";
      writable_roots?: string[];
      network_access?: boolean;
      exclude_tmpdir_env_var?: boolean;
      exclude_slash_tmp?: boolean;
    };

export interface NewConversationParams {
  model?: string;
  cwd?: string;
  approvalPolicy?: AskForApproval;
  sandboxPolicy?: SandboxPolicy;
  initialImages?: string[];
  initialPrompt?: string;
}

export type InputItem =
  | { type: "text"; data: { text: string } }
  | { type: "image"; data: { imageUrl: string } }
  | { type: "localImage"; data: { path: string } };

export interface SendUserMessageParams {
  conversationId: string;
  items: InputItem[];
}

export interface AddConversationListenerParams {
  conversationId: string;
}

export interface AddConversationListenerResult {
  subscriptionId: string;
}

export interface RemoveConversationListenerParams {
  subscriptionId: string;
}

export interface ConversationEvent {
  conversationId: string;
  summary: string;
  method: string;
  payload: unknown;
}

export type ClientMethod =
  | "initialize"
  | "newConversation"
  | "sendUserMessage"
  | "sendUserTurn"
  | "addConversationListener"
  | "removeConversationListener";

export interface ClientRequestEnvelope {
  method: ClientMethod;
  params?: unknown;
}

export type ReviewDecision = "approved" | "approved_for_session" | "denied" | "abort";

export interface ExecCommandApprovalParams {
  conversationId: string;
  callId: string;
  command: string[];
  cwd: string;
  reason?: string;
}

export interface ExecCommandApprovalResult {
  decision: ReviewDecision;
}

export interface ApplyPatchApprovalParams {
  conversationId: string;
  callId: string;
  fileChanges: Record<string, unknown>;
  reason?: string;
  grantRoot?: string;
}

export interface ApplyPatchApprovalResult {
  decision: ReviewDecision;
}
