import { contextBridge, ipcRenderer } from "electron";
import type {
  AddConversationListenerParams,
  InitializeParams,
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcResponse,
  NewConversationParams,
  RemoveConversationListenerParams,
  RequestId,
  SendUserMessageParams,
} from "./types";

type Listener<T> = (payload: T) => void;

const subscriptions = new Map<string, (...args: unknown[]) => void>();

function subscribe<T>(
  channel: string,
  listener: Listener<T>,
): () => void {
  const wrapped = (...args: unknown[]) => {
    const [, payload] = args;
    listener(payload as T);
  };
  subscriptions.set(channel, wrapped);
  ipcRenderer.on(channel, wrapped);

  return () => {
    const handler = subscriptions.get(channel);
    if (handler) {
      ipcRenderer.removeListener(channel, handler);
      subscriptions.delete(channel);
    }
  };
}

export interface CodexBridgeApi {
  initialize(params?: InitializeParams): Promise<JsonRpcResponse>;
  newConversation(params?: NewConversationParams): Promise<JsonRpcResponse>;
  sendUserMessage(params: SendUserMessageParams): Promise<JsonRpcResponse>;
  addConversationListener(
    params: AddConversationListenerParams,
  ): Promise<JsonRpcResponse>;
  removeConversationListener(
    params: RemoveConversationListenerParams,
  ): Promise<JsonRpcResponse>;
  sendNotification(notification: JsonRpcNotification): void;
  respond(requestId: RequestId, result?: unknown): void;
  selectDirectory(): Promise<string | null>;
  onMessage(listener: Listener<{ message: JsonRpcMessage; raw: unknown }>): () => void;
  onRaw(listener: Listener<string>): () => void;
  onReady(listener: Listener<{ initialized: boolean; defaultCwd?: string }>): () => void;
  onError(listener: Listener<string>): () => void;
  onExit(listener: Listener<{ code: number | null; signal: NodeJS.Signals | null }>): () => void;
}

const api: CodexBridgeApi = {
  initialize(params) {
    return ipcRenderer.invoke("codex:initialize", params);
  },
  newConversation(params) {
    return ipcRenderer.invoke("codex:new-conversation", params ?? {});
  },
  sendUserMessage(params) {
    return ipcRenderer.invoke("codex:send-user-message", params);
  },
  addConversationListener(params) {
    return ipcRenderer.invoke("codex:add-conversation-listener", params);
  },
  removeConversationListener(params) {
    return ipcRenderer.invoke("codex:remove-conversation-listener", params);
  },
  sendNotification(notification) {
    ipcRenderer.send("codex:notify", notification);
  },
  respond(requestId, result) {
    ipcRenderer.send("codex:respond", { id: requestId, result });
  },
  selectDirectory() {
    return ipcRenderer.invoke("codex:select-directory");
  },
  onMessage(listener) {
    return subscribe("codex:message", listener);
  },
  onRaw(listener) {
    return subscribe("codex:raw", listener);
  },
  onReady(listener) {
    return subscribe("codex:ready", listener);
  },
  onError(listener) {
    return subscribe("codex:error", listener);
  },
  onExit(listener) {
    return subscribe("codex:exit", listener);
  },
};

contextBridge.exposeInMainWorld("codexBridge", api);

declare global {
  interface Window {
    codexBridge: CodexBridgeApi;
  }
}
