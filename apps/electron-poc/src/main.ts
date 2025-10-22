import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import { AppServerBridge } from "./appServerBridge";
import type {
  AddConversationListenerParams,
  InitializeParams,
  JsonRpcNotification,
  NewConversationParams,
  RemoveConversationListenerParams,
  RequestId,
  SendUserMessageParams,
} from "./types";

let mainWindow: BrowserWindow | null = null;
let bridge: AppServerBridge | null = null;

function getRendererIndex(): string {
  return path.resolve(__dirname, "../src/renderer/index.html");
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 640,
    minHeight: 480,
    webPreferences: {
      preload: path.resolve(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await mainWindow.loadFile(getRendererIndex());

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function forwardToRenderer(channel: string, payload: unknown): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send(channel, payload);
}

async function bootstrapBridge(): Promise<void> {
  bridge = new AppServerBridge();

  bridge.on("message", (message, raw) => {
    forwardToRenderer("codex:message", { message, raw });
  });

  bridge.on("raw", (line) => {
    forwardToRenderer("codex:raw", line);
  });

  bridge.on("error", (error) => {
    forwardToRenderer("codex:error", error.message);
  });

  bridge.on("exit", (code, signal) => {
    forwardToRenderer("codex:exit", { code, signal });
  });

  try {
    await bridge.start();
    forwardToRenderer("codex:ready", { initialized: true, defaultCwd: process.cwd() });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : JSON.stringify(error);
    await dialog.showErrorBox(
      "Failed to start Codex app server",
      message ?? "Unknown error",
    );
    throw error;
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle(
    "codex:new-conversation",
    async (_event, params: NewConversationParams) => {
      if (!bridge) {
        throw new Error("Bridge not ready");
      }
      return bridge.newConversation(params);
    },
  );

  ipcMain.handle(
    "codex:initialize",
    async (_event, params: InitializeParams | undefined) => {
      if (!bridge) {
        throw new Error("Bridge not ready");
      }
      const response = await bridge.initialize(
        params ?? {
          clientInfo: {
            name: "codex-electron-poc",
            version: app.getVersion(),
          },
        },
      );
      return response;
    },
  );

  ipcMain.handle(
    "codex:send-user-message",
    async (_event, params: SendUserMessageParams) => {
      if (!bridge) {
        throw new Error("Bridge not ready");
      }
      return bridge.sendUserMessage(params);
    },
  );

  ipcMain.handle(
    "codex:add-conversation-listener",
    async (_event, params: AddConversationListenerParams) => {
      if (!bridge) {
        throw new Error("Bridge not ready");
      }
      return bridge.addConversationListener(params);
    },
  );

  ipcMain.handle(
    "codex:remove-conversation-listener",
    async (_event, params: RemoveConversationListenerParams) => {
      if (!bridge) {
        throw new Error("Bridge not ready");
      }
      return bridge.removeConversationListener(params);
    },
  );

  ipcMain.on(
    "codex:notify",
    (_event, notification: JsonRpcNotification) => {
      if (!bridge) {
        throw new Error("Bridge not ready");
      }
      bridge.sendNotification(notification.method, notification.params);
    },
  );

  ipcMain.on(
    "codex:respond",
    (_event, payload: { id: RequestId; result?: unknown }) => {
      if (!bridge) {
        throw new Error("Bridge not ready");
      }
      bridge.sendResponse(payload.id, payload.result);
    },
  );

  ipcMain.handle("codex:select-directory", async () => {
    const browserWindow = BrowserWindow.getFocusedWindow() ?? mainWindow ?? undefined;
    const options = {
      properties: ["openDirectory", "createDirectory"] as Array<"openFile" | "openDirectory" | "multiSelections" | "showHiddenFiles" | "createDirectory" | "promptToCreate" | "noResolveAliases" | "treatPackageAsDirectory" | "dontAddToRecent">,
    };
    const { canceled, filePaths } = browserWindow
      ? await dialog.showOpenDialog(browserWindow, options)
      : await dialog.showOpenDialog(options);
    if (canceled || filePaths.length === 0) {
      return null;
    }
    return filePaths[0];
  });
}

app.whenReady().then(async () => {
  registerIpcHandlers();
  await bootstrapBridge();
  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  bridge?.dispose();
});
