import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import process from "node:process";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";
import type {
  AddConversationListenerParams,
  InitializeParams,
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcError,
  NewConversationParams,
  RequestId,
  SendUserMessageParams,
  RemoveConversationListenerParams,
} from "./types";

type LogDirection = "inbound" | "outbound" | "stderr";

type BridgeEvents = {
  ready: [];
  message: [JsonRpcMessage, unknown];
  raw: [string];
  exit: [code: number | null, signal: NodeJS.Signals | null];
  error: [error: Error];
};

export interface AppServerBridgeOptions {
  /**
   * Path to the codex executable. Defaults to `codex` (expects it on PATH).
   */
  codexBinary?: string;
  /**
   * Working directory for the spawned app server. Default: current working dir.
   */
  cwd?: string;
  /**
   * Extra environment variables for the app server process.
   */
  env?: NodeJS.ProcessEnv;
  /**
   * Optional structured logger for inbound/outbound traffic.
   */
  logger?: (direction: LogDirection, payload: unknown) => void;
  /**
   * Automatically send the initialize request once the server is ready.
   * Default: true.
   */
  autoInitialize?: boolean;
}

interface PendingRequest {
  resolve: (message: JsonRpcResponse) => void;
  reject: (error: JsonRpcError) => void;
}

export class AppServerBridge extends EventEmitter {
  private readonly options: Required<AppServerBridgeOptions>;
  private child?: ChildProcessWithoutNullStreams;
  private nextRequestId = 1;
  private readonly pending = new Map<RequestId, PendingRequest>();
  private started = false;
  private readonly readyPromise: Promise<void>;
  private readyResolver: (() => void) | null = null;

  constructor(options: AppServerBridgeOptions = {}) {
    super();
    const {
      codexBinary = process.env.CODEX_BIN ?? "codex",
      cwd = process.cwd(),
      env = {},
      logger = AppServerBridge.defaultLogger,
      autoInitialize = true,
    } = options;

    this.options = {
      codexBinary,
      cwd,
      env,
      logger,
      autoInitialize,
    };

    this.readyPromise = new Promise<void>((resolve) => {
      this.readyResolver = resolve;
    });
  }

  static defaultLogger(direction: LogDirection, payload: unknown): void {
    const prefix =
      direction === "inbound"
        ? "\u2190 codex"
        : direction === "outbound"
          ? "codex \u2192"
          : "codex stderr";
    // eslint-disable-next-line no-console
    console.debug(prefix, payload);
  }

  async start(): Promise<void> {
    if (this.started) {
      throw new Error("AppServerBridge already started");
    }
    this.started = true;

    this.child = spawn(
      this.options.codexBinary,
      ["app-server"],
      {
        cwd: this.options.cwd,
        env: {
          ...process.env,
          ...this.options.env,
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    this.child.on("error", (error) => {
      this.emit("error", error);
    });

    this.child.on("exit", (code, signal) => {
      this.emit("exit", code, signal);
    });

    const stdout = createInterface({
      input: this.child.stdout,
      crlfDelay: Infinity,
    });

    stdout.on("line", (line) => {
      this.emit("raw", line);
      this.options.logger("inbound", line);
      this.handleLine(line);
    });

    const stderr = createInterface({
      input: this.child.stderr,
      crlfDelay: Infinity,
    });

    stderr.on("line", (line) => {
      this.options.logger("stderr", line);
    });

    this.readyResolver?.();
    this.readyResolver = null;
    this.emit("ready");

    if (this.options.autoInitialize) {
      await this.initialize();
    }
  }

  async waitUntilReady(): Promise<void> {
    await this.readyPromise;
  }

  dispose(): void {
    for (const [, { reject }] of this.pending) {
      reject({
        id: -1,
        error: {
          code: -1,
          message: "App server bridge disposed",
        },
      });
    }
    this.pending.clear();
    if (this.child && !this.child.killed) {
      this.child.kill();
    }
  }

  async initialize(
    params: InitializeParams = {
      clientInfo: { name: "codex-electron-poc", version: "0.1.0" },
    },
  ): Promise<JsonRpcResponse> {
    return this.sendRequest("initialize", params);
  }

  async newConversation(
    params: NewConversationParams = {},
  ): Promise<JsonRpcResponse> {
    return this.sendRequest("newConversation", params);
  }

  async sendUserMessage(
    params: SendUserMessageParams,
  ): Promise<JsonRpcResponse> {
    return this.sendRequest("sendUserMessage", params);
  }

  async addConversationListener(
    params: AddConversationListenerParams,
  ): Promise<JsonRpcResponse> {
    return this.sendRequest("addConversationListener", params);
  }

  async removeConversationListener(
    params: RemoveConversationListenerParams,
  ): Promise<JsonRpcResponse> {
    return this.sendRequest("removeConversationListener", params);
  }

  sendNotification(method: string, params?: unknown): void {
    const message: JsonRpcNotification = { method, params };
    this.writeMessage(message);
  }

  sendResponse(id: RequestId, result?: unknown): void {
    this.writePayload({ id, result });
  }

  private async sendRequest(
    method: string,
    params?: unknown,
  ): Promise<JsonRpcResponse> {
    const id = this.nextRequestId++;
    const request: JsonRpcRequest = { id, method, params };

    await this.waitUntilReady();

    return new Promise<JsonRpcResponse>((resolve, reject) => {
      this.pending.set(id, {
        resolve,
        reject: (error) => {
          reject(error);
        },
      });
      this.writeMessage(request);
    });
  }

  private writeMessage(message: JsonRpcNotification | JsonRpcRequest): void {
    this.writePayload(message);
  }

  private writePayload(payload: unknown): void {
    if (!this.child || !this.child.stdin.writable) {
      throw new Error("App server process not ready to accept input");
    }

    const serialized = JSON.stringify(payload);
    this.options.logger("outbound", serialized);
    this.child.stdin.write(`${serialized}\n`, (error) => {
      if (error) {
        this.emit("error", error);
      }
    });
  }

  private handleLine(line: string): void {
    let rawJson: unknown;
    try {
      rawJson = JSON.parse(line);
    } catch (error) {
      const err =
        error instanceof Error
          ? error
          : new Error(`Failed to parse JSON: ${String(error)}`);
      this.emit("error", err);
      return;
    }

    const message = this.toJsonRpcMessage(rawJson);
    if (!message) {
      this.emit(
        "error",
        new Error(`Unknown JSON-RPC message shape: ${line}`),
      );
      return;
    }

    this.emit("message", message, rawJson);

    switch (message.kind) {
      case "response":
        this.resolvePending(message.response);
        break;
      case "error":
        this.rejectPending(message.error);
        break;
      default:
        break;
    }
  }

  private resolvePending(response: JsonRpcResponse): void {
    const pending = this.pending.get(response.id);
    if (pending) {
      pending.resolve(response);
      this.pending.delete(response.id);
    }
  }

  private rejectPending(error: JsonRpcError): void {
    const pending = this.pending.get(error.id);
    if (pending) {
      pending.reject(error);
      this.pending.delete(error.id);
    }
  }

  private toJsonRpcMessage(raw: unknown): JsonRpcMessage | undefined {
    if (typeof raw !== "object" || raw === null) {
      return undefined;
    }

    const candidate = raw as Record<string, unknown>;
    const idValue = candidate.id;
    const methodValue = candidate.method;
    const resultValue = candidate.result;
    const errorValue = candidate.error;

    const hasId =
      typeof idValue === "number" || typeof idValue === "string";
    const hasMethod = typeof methodValue === "string";

    if (hasId && hasMethod) {
      const request: JsonRpcRequest = {
        id: idValue as RequestId,
        method: methodValue as string,
        params: candidate.params,
      };
      return { kind: "request", request };
    }

    if (hasMethod) {
      const notification: JsonRpcNotification = {
        method: methodValue as string,
        params: candidate.params,
      };
      return { kind: "notification", notification };
    }

    if (hasId && "result" in candidate) {
      const response: JsonRpcResponse = {
        id: idValue as RequestId,
        result: resultValue,
      };
      return { kind: "response", response };
    }

    if (
      hasId &&
      "error" in candidate &&
      typeof errorValue === "object" &&
      errorValue !== null &&
      typeof (errorValue as { code?: unknown }).code === "number" &&
      typeof (errorValue as { message?: unknown }).message === "string"
    ) {
      const errorBody = errorValue as {
        code: number;
        message: string;
        data?: unknown;
      };
      const error: JsonRpcError = {
        id: idValue as RequestId,
        error: {
          code: errorBody.code,
          message: errorBody.message,
          data: errorBody.data,
        },
      };
      return { kind: "error", error };
    }

    return undefined;
  }
}

export interface AppServerBridge {
  on<K extends keyof BridgeEvents>(
    event: K,
    listener: (...args: BridgeEvents[K]) => void,
  ): this;
  once<K extends keyof BridgeEvents>(
    event: K,
    listener: (...args: BridgeEvents[K]) => void,
  ): this;
  off<K extends keyof BridgeEvents>(
    event: K,
    listener: (...args: BridgeEvents[K]) => void,
  ): this;
  emit<K extends keyof BridgeEvents>(
    event: K,
    ...args: BridgeEvents[K]
  ): boolean;
}

export type { JsonRpcMessage } from "./types";
