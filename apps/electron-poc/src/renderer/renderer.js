const statusLine = document.getElementById("status-line");
const conversationLine = document.getElementById("conversation-id");
const eventFeed = document.getElementById("event-feed");
const logFeed = document.getElementById("log-feed");
const startButton = document.getElementById("start-conversation");
const sendButton = document.getElementById("send-message");
const userInput = document.getElementById("user-input");
const cwdInput = document.getElementById("cwd-input");
const browseCwdButton = document.getElementById("browse-cwd");
const sandboxSelect = document.getElementById("sandbox-select");
const approvalList = document.getElementById("approval-requests");
const approvalEmpty = document.getElementById("approval-empty");

let activeConversationId = null;
let activeSubscriptionId = null;
let initialized = false;
const pendingApprovalRequests = new Map();

function appendListItem(list, content) {
  let item;
  if (content instanceof Node) {
    if (content instanceof HTMLLIElement) {
      item = content;
    } else {
      item = document.createElement("li");
      item.appendChild(content);
    }
  } else {
    item = document.createElement("li");
    item.innerHTML = content;
  }
  list.appendChild(item);
  list.scrollTop = list.scrollHeight;
  return item;
}

function formatJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return String(value);
  }
}

function createInlineCode(text) {
  const code = document.createElement("code");
  code.textContent = text;
  return code;
}

function createPre(text, className = "event__code") {
  const pre = document.createElement("pre");
  pre.className = className;
  pre.textContent = text;
  return pre;
}

function formatCommand(command) {
  if (!Array.isArray(command)) {
    return "";
  }
  return command
    .map((part) => {
      if (typeof part !== "string") {
        return String(part);
      }
      if (part === "") {
        return '""';
      }
      if (/\s|["'`]/.test(part)) {
        return JSON.stringify(part);
      }
      return part;
    })
    .join(" ");
}

function sandboxSelectionToPolicy(selection) {
  if (selection === "workspace-write") {
    return { mode: "workspace-write" };
  }
  if (selection === "danger-full-access") {
    return { mode: "danger-full-access" };
  }
  return { mode: "read-only" };
}

function formatDecisionLabel(decision) {
  return decision.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function updateApprovalEmptyState() {
  if (!approvalEmpty) {
    return;
  }
  approvalEmpty.style.display = pendingApprovalRequests.size === 0 ? "" : "none";
}

function clearPendingApprovalRequests() {
  for (const entry of pendingApprovalRequests.values()) {
    entry.element.remove();
  }
  pendingApprovalRequests.clear();
  updateApprovalEmptyState();
}

const textDecoder = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8") : null;

function decodeBase64Chunk(chunk) {
  if (typeof chunk !== "string" || chunk.length === 0) {
    return "";
  }
  try {
    const binary = atob(chunk);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    if (textDecoder) {
      return textDecoder.decode(bytes);
    }
    let fallback = "";
    for (let index = 0; index < bytes.length; index += 1) {
      fallback += String.fromCharCode(bytes[index]);
    }
    return fallback;
  } catch (error) {
    return "";
  }
}

function formatNumber(value) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(numeric)) {
    return "0";
  }
  return numeric.toLocaleString("en-US");
}

function formatWindowMinutes(minutes) {
  if (minutes === null || minutes === undefined) {
    return null;
  }
  if (minutes === 0) {
    return "0m";
  }
  if (minutes % (60 * 24) === 0) {
    return `${minutes / (60 * 24)}d`;
  }
  if (minutes % 60 === 0) {
    return `${minutes / 60}h`;
  }
  return `${minutes}m`;
}

function formatRateLimit(window) {
  if (!window) {
    return "unknown";
  }
  const parts = [];
  if (typeof window.used_percent === "number") {
    parts.push(`${Math.round(window.used_percent)}% used`);
  }
  const windowLabel = formatWindowMinutes(window.window_minutes ?? null);
  if (windowLabel) {
    parts.push(windowLabel);
  }
  if (typeof window.resets_in_seconds === "number" && window.resets_in_seconds > 0) {
    const minutes = Math.round(window.resets_in_seconds / 60);
    if (minutes > 0) {
      parts.push(`resets in ~${minutes}m`);
    }
  }
  return parts.join(" • ") || "unknown";
}

function describeTokenUsage(msg) {
  const lines = [];
  const details = [];
  const info = msg && typeof msg === "object" ? msg.info : null;
  const total = info && typeof info === "object" ? info.total_token_usage : null;
  const last = info && typeof info === "object" ? info.last_token_usage : null;

  if (total) {
    const segments = [];
    if (typeof total.total_tokens === "number" && total.total_tokens > 0) {
      segments.push(`total ${formatNumber(total.total_tokens)}`);
    }
    const input = typeof total.input_tokens === "number" ? total.input_tokens : 0;
    const cached = typeof total.cached_input_tokens === "number" ? total.cached_input_tokens : 0;
    if (input > 0 || cached > 0) {
      let label = `input ${formatNumber(input)}`;
      if (cached > 0) {
        label += ` (+ ${formatNumber(cached)} cached)`;
      }
      segments.push(label);
    }
    if (typeof total.output_tokens === "number" && total.output_tokens > 0) {
      segments.push(`output ${formatNumber(total.output_tokens)}`);
    }
    if (typeof total.reasoning_output_tokens === "number" && total.reasoning_output_tokens > 0) {
      segments.push(`reasoning ${formatNumber(total.reasoning_output_tokens)}`);
    }
    if (segments.length > 0) {
      lines.push(`Total: ${segments.join(" · ")}`);
    }
  }

  if (last) {
    const segments = [];
    const input = typeof last.input_tokens === "number" ? last.input_tokens : 0;
    const cached = typeof last.cached_input_tokens === "number" ? last.cached_input_tokens : 0;
    if (input > 0 || cached > 0) {
      let label = `input ${formatNumber(input)}`;
      if (cached > 0) {
        label += ` (+ ${formatNumber(cached)} cached)`;
      }
      segments.push(label);
    }
    if (typeof last.output_tokens === "number" && last.output_tokens > 0) {
      segments.push(`output ${formatNumber(last.output_tokens)}`);
    }
    if (typeof last.reasoning_output_tokens === "number" && last.reasoning_output_tokens > 0) {
      segments.push(`reasoning ${formatNumber(last.reasoning_output_tokens)}`);
    }
    if (segments.length > 0) {
      lines.push(`Last turn: ${segments.join(" · ")}`);
    }
  }

  if (info && typeof info.model_context_window === "number") {
    lines.push(`Context window: ${formatNumber(info.model_context_window)} tokens`);
  }

  if (lines.length === 0) {
    lines.push("Token usage unavailable.");
  }

  const rateLimits = msg && typeof msg === "object" ? msg.rate_limits : null;
  if (rateLimits && typeof rateLimits === "object") {
    if (rateLimits.primary) {
      details.push({
        key: "primary",
        label: "primary limit",
        value: formatRateLimit(rateLimits.primary),
      });
    }
    if (rateLimits.secondary) {
      details.push({
        key: "secondary",
        label: "secondary limit",
        value: formatRateLimit(rateLimits.secondary),
      });
    }
  }

  return { summary: lines.join("\n"), details };
}

function formatPlanStatus(status) {
  if (status === "completed") {
    return "[x]";
  }
  if (status === "in_progress") {
    return "[>]";
  }
  return "[ ]";
}

function summarizeAgentMessageForStatus(message) {
  const collapsed = message.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) {
    return "Codex replied.";
  }
  if (collapsed.length > 160) {
    return `Codex replied: ${collapsed.slice(0, 160).trimEnd()}…`;
  }
  return `Codex replied: ${collapsed}`;
}

function changesToPaths(changes) {
  if (!changes || typeof changes !== "object") {
    return [];
  }
  const paths = [];
  for (const key of Object.keys(changes)) {
    paths.push(key);
  }
  paths.sort((a, b) => a.localeCompare(b));
  return paths;
}

function summarizeFileList(paths, maxLines = 5) {
  if (!paths || paths.length === 0) {
    return "";
  }
  const display = paths.slice(0, maxLines);
  const summary = display.join("\n");
  if (paths.length > maxLines) {
    return `${summary}\n(+${paths.length - maxLines} more)`;
  }
  return summary;
}

class ConversationRenderer {
  constructor(listElement) {
    this.listElement = listElement;
    this.itemsById = new Map();
    this.specialItems = new Map();
    this.pendingUserItems = [];
  }

  labelForRole(role) {
    switch (role) {
      case "agent":
        return "Codex";
      case "user":
        return "You";
      case "tool":
        return "Command";
      case "error":
        return "Error";
      case "plan":
        return "Plan";
      default:
        return "System";
    }
  }

  nowString() {
    return new Date().toLocaleTimeString();
  }

  makeId(raw) {
    if (raw === null || raw === undefined) {
      return null;
    }
    return String(raw);
  }

  scrollToBottom() {
    this.listElement.scrollTop = this.listElement.scrollHeight;
  }

  createItem(role, id, timestamp, label) {
    const li = document.createElement("li");
    li.classList.add("event", `event--${role}`);

    const header = document.createElement("div");
    header.className = "event__header";

    const roleSpan = document.createElement("span");
    roleSpan.className = "event__role";
    roleSpan.textContent = label ?? this.labelForRole(role);

    const metaSpan = document.createElement("span");
    metaSpan.className = "event__meta";

    header.append(roleSpan, metaSpan);

    const body = document.createElement("div");
    body.className = "event__body";

    const textEl = document.createElement("div");
    textEl.className = "event__text";
    body.appendChild(textEl);

    li.append(header, body);
    this.listElement.appendChild(li);

    const item = {
      id: id ?? null,
      role,
      li,
      roleSpan,
      metaSpan,
      body,
      textEl,
      reasoningEl: null,
      messageText: "",
      reasoningText: "",
      meta: { status: "", timestamp: "" },
      detailsEl: null,
      details: new Map(),
      outputContainer: null,
      stdoutEl: null,
      stdoutText: "",
      stderrEl: null,
      stderrText: "",
      notes: new Map(),
    };

    if (id) {
      this.itemsById.set(id, item);
    }

    this.updateMeta(item, { timestamp: timestamp ?? this.nowString() });
    this.scrollToBottom();
    return item;
  }

  updateLabel(item, label) {
    item.roleSpan.textContent = label;
  }

  updateMeta(item, updates) {
    item.meta = item.meta ?? { status: "", timestamp: "" };
    if (typeof updates.status === "string") {
      item.meta.status = updates.status;
    }
    if (typeof updates.timestamp === "string") {
      item.meta.timestamp = updates.timestamp;
    }
    const parts = [];
    if (item.meta.status) {
      parts.push(item.meta.status);
    }
    if (item.meta.timestamp) {
      parts.push(item.meta.timestamp);
    }
    item.metaSpan.textContent = parts.join(" • ");
  }

  updateText(item, text) {
    item.messageText = text ?? "";
    if (item.textEl) {
      item.textEl.textContent = item.messageText;
      item.textEl.style.display = item.messageText ? "" : "none";
    }
  }

  appendText(item, delta) {
    const addition = delta ?? "";
    item.messageText = (item.messageText ?? "") + addition;
    if (item.textEl) {
      item.textEl.textContent = item.messageText;
      item.textEl.style.display = item.messageText ? "" : "none";
    }
  }

  ensureReasoning(item) {
    if (!item.reasoningEl) {
      const reasoning = document.createElement("div");
      reasoning.className = "event__reasoning";
      item.body.insertBefore(reasoning, item.textEl);
      item.reasoningEl = reasoning;
      item.reasoningText = "";
    }
    return item.reasoningEl;
  }

  updateReasoning(item, text) {
    this.ensureReasoning(item);
    item.reasoningText = text ?? "";
    item.reasoningEl.textContent = item.reasoningText;
  }

  appendReasoning(item, delta) {
    const addition = delta ?? "";
    this.ensureReasoning(item);
    item.reasoningText = (item.reasoningText ?? "") + addition;
    item.reasoningEl.textContent = item.reasoningText;
  }

  ensureDetailsContainer(item) {
    if (!item.detailsEl) {
      const details = document.createElement("div");
      details.className = "event__details";
      this.insertBeforeDetails(item, details);
      item.detailsEl = details;
    }
    return item.detailsEl;
  }

  insertBeforeDetails(item, node) {
    if (item.detailsEl) {
      item.body.insertBefore(node, item.detailsEl);
    } else if (item.outputContainer) {
      item.body.insertBefore(node, item.outputContainer);
    } else {
      item.body.appendChild(node);
    }
  }

  setDetail(item, key, label, value) {
    if (value === null || value === undefined || value === "") {
      this.removeDetail(item, key);
      return;
    }
    const container = this.ensureDetailsContainer(item);
    let entry = item.details.get(key);
    if (!entry) {
      entry = document.createElement("div");
      entry.className = "event__detail";
      container.appendChild(entry);
      item.details.set(key, entry);
    }
    entry.textContent = `${label}: ${value}`;
  }

  removeDetail(item, key) {
    if (!item.details.has(key)) {
      return;
    }
    const entry = item.details.get(key);
    if (entry) {
      entry.remove();
    }
    item.details.delete(key);
    if (item.details.size === 0 && item.detailsEl) {
      item.detailsEl.remove();
      item.detailsEl = null;
    }
  }

  replaceDetails(item, entries) {
    if (item.detailsEl) {
      item.detailsEl.remove();
      item.detailsEl = null;
    }
    item.details = new Map();
    if (!entries || entries.length === 0) {
      return;
    }
    for (const entry of entries) {
      this.setDetail(item, entry.key, entry.label, entry.value);
    }
  }

  ensureCommandOutputs(item) {
    if (!item.outputContainer) {
      const container = document.createElement("div");
      container.className = "event__outputs";
      item.body.appendChild(container);
      item.outputContainer = container;
    }
    return item.outputContainer;
  }

  getCommandStreamElement(item, stream) {
    this.ensureCommandOutputs(item);
    if (stream === "stderr") {
      if (!item.stderrEl) {
        const pre = createPre("", "event__code event__code--stderr");
        pre.style.display = "none";
        item.outputContainer.appendChild(pre);
        item.stderrEl = pre;
        item.stderrText = "";
      }
      return item.stderrEl;
    }
    if (!item.stdoutEl) {
      const pre = createPre("", "event__code event__code--stdout");
      pre.style.display = "none";
      item.outputContainer.appendChild(pre);
      item.stdoutEl = pre;
      item.stdoutText = "";
    }
    return item.stdoutEl;
  }

  appendCommandOutput(item, stream, text) {
    if (!text) {
      return;
    }
    const target = this.getCommandStreamElement(item, stream);
    if (stream === "stderr") {
      item.stderrText = (item.stderrText ?? "") + text;
      target.textContent = item.stderrText;
    } else {
      item.stdoutText = (item.stdoutText ?? "") + text;
      target.textContent = item.stdoutText;
    }
    target.style.display = target.textContent ? "" : "none";
    this.scrollToBottom();
  }

  setCommandOutput(item, stream, text) {
    if (text === null || text === undefined) {
      return;
    }
    const target = this.getCommandStreamElement(item, stream);
    if (stream === "stderr") {
      item.stderrText = text;
    } else {
      item.stdoutText = text;
    }
    target.textContent = text;
    target.style.display = text ? "" : "none";
    this.scrollToBottom();
  }

  setNote(item, key, text, variant) {
    if (!text) {
      if (item.notes.has(key)) {
        const existing = item.notes.get(key);
        existing.remove();
        item.notes.delete(key);
      }
      return;
    }
    let node = item.notes.get(key);
    if (!node) {
      node = document.createElement("div");
      node.className = "event__note";
      this.insertBeforeDetails(item, node);
      item.notes.set(key, node);
    }
    node.textContent = text;
    node.classList.toggle("event__note--error", variant === "error");
  }

  createJsonBlock(value) {
    return createPre(formatJson(value), "event__json");
  }

  addSystemMessage(title, detail, timestamp, options = {}) {
    const role = options.role ?? "system";
    const label = options.label;
    const detailVariant = options.detailVariant;
    const item = this.createItem(role, null, timestamp, label);
    this.updateText(item, title ?? "");
    if (detail instanceof Node) {
      this.insertBeforeDetails(item, detail);
    } else if (detail !== undefined && detail !== null && detail !== "") {
      if (typeof detail === "string") {
        this.setNote(item, "detail", detail, detailVariant);
      } else {
        this.insertBeforeDetails(item, this.createJsonBlock(detail));
      }
    }
    return item;
  }

  addErrorMessage(title, detail, timestamp) {
    const item = this.addSystemMessage(title, detail, timestamp, {
      role: "error",
      label: "Error",
      detailVariant: "error",
    });
    this.updateMeta(item, { status: "Error", timestamp });
    return item;
  }

  getSpecialItem(key, role, label, timestamp) {
    let item = this.specialItems.get(key);
    if (!item) {
      item = this.createItem(role, null, timestamp, label);
      this.specialItems.set(key, item);
    } else {
      if (label) {
        this.updateLabel(item, label);
      }
      this.updateMeta(item, { timestamp });
    }
    return item;
  }

  ensureAgentItem(id, timestamp) {
    const key = this.makeId(id);
    if (!key) {
      return this.createItem("agent", null, timestamp);
    }
    let item = this.itemsById.get(key);
    if (!item) {
      item = this.createItem("agent", key, timestamp);
    } else {
      this.updateMeta(item, { timestamp });
    }
    return item;
  }

  ensureUserItem(id, timestamp) {
    const key = this.makeId(id);
    if (!key) {
      return this.createItem("user", null, timestamp);
    }
    let item = this.itemsById.get(key);
    if (!item) {
      item = this.createItem("user", key, timestamp);
    } else {
      this.updateMeta(item, { timestamp });
    }
    return item;
  }

  ensureToolItem(callId, timestamp) {
    const key = callId ? `tool:${callId}` : null;
    if (!key) {
      return this.createItem("tool", null, timestamp, "Command");
    }
    let item = this.itemsById.get(key);
    if (!item) {
      item = this.createItem("tool", key, timestamp, "Command");
    } else {
      this.updateMeta(item, { timestamp });
    }
    return item;
  }

  addLocalUserMessage(text) {
    const item = this.createItem("user", null, this.nowString());
    this.updateText(item, text);
    this.updateMeta(item, { status: "Sending", timestamp: this.nowString() });
    this.pendingUserItems.push(item);
    return item;
  }

  markUserMessageQueued(item) {
    if (!item) {
      return;
    }
    this.updateMeta(item, { status: "Queued", timestamp: this.nowString() });
  }

  removePendingUserItem(item) {
    const index = this.pendingUserItems.indexOf(item);
    if (index >= 0) {
      this.pendingUserItems.splice(index, 1);
    }
  }

  markUserMessageFailed(item, reason) {
    if (!item) {
      return;
    }
    this.removePendingUserItem(item);
    this.updateMeta(item, { status: "Failed", timestamp: this.nowString() });
    if (reason) {
      this.setNote(item, "error", reason, "error");
    }
  }

  takePendingUserItem() {
    if (this.pendingUserItems.length === 0) {
      return null;
    }
    return this.pendingUserItems.shift();
  }

  handleUserMessage(idRaw, msg, timestamp) {
    const id = this.makeId(idRaw);
    const pending = this.takePendingUserItem();
    let item = pending;
    if (!item && id) {
      item = this.itemsById.get(id) ?? null;
    }
    if (!item) {
      item = this.createItem("user", id, timestamp);
    } else {
      this.updateMeta(item, { timestamp });
      if (id && item.id !== id) {
        if (item.id) {
          this.itemsById.delete(item.id);
        }
        item.id = id;
        this.itemsById.set(id, item);
      }
    }
    const text = msg && typeof msg === "object" ? msg.message ?? "" : "";
    this.updateText(item, text);
    this.setNote(item, "error", null);
    this.updateMeta(item, { status: "Sent", timestamp });
  }

  handleAgentReasoningDelta(id, delta, timestamp) {
    const item = this.ensureAgentItem(id, timestamp);
    const wasEmpty = !item.reasoningText;
    this.appendReasoning(item, delta);
    this.updateMeta(item, { status: "Thinking", timestamp });
    if (wasEmpty && delta.trim().length > 0) {
      return "Codex is thinking…";
    }
    return undefined;
  }

  handleAgentReasoning(id, text, timestamp) {
    const item = this.ensureAgentItem(id, timestamp);
    this.updateReasoning(item, text);
    this.updateMeta(item, { status: "Thinking", timestamp });
  }

  handleAgentMessageDelta(id, delta, timestamp) {
    const item = this.ensureAgentItem(id, timestamp);
    const wasEmpty = !item.messageText;
    this.appendText(item, delta);
    this.updateMeta(item, { status: "Responding", timestamp });
    if (wasEmpty && delta.trim().length > 0) {
      return "Codex is replying…";
    }
    return undefined;
  }

  handleAgentMessage(id, text, timestamp) {
    const item = this.ensureAgentItem(id, timestamp);
    this.updateText(item, text);
    this.updateMeta(item, { status: "Replied", timestamp });
    return text;
  }

  handleTaskComplete(msg, timestamp) {
    const item = this.addSystemMessage("Task complete", null, timestamp, { label: "Task" });
    if (msg && typeof msg === "object" && msg.last_agent_message) {
      const quote = document.createElement("div");
      quote.className = "event__quote";
      quote.textContent = msg.last_agent_message;
      this.insertBeforeDetails(item, quote);
    }
    this.updateMeta(item, { status: "Done", timestamp });
    return "Codex finished the task.";
  }

  handleTokenCount(msg, timestamp) {
    const description = describeTokenUsage(msg);
    const item = this.getSpecialItem("token-usage", "system", "Token usage", timestamp);
    this.updateText(item, description.summary);
    this.replaceDetails(item, description.details);
    this.updateMeta(item, { status: "Updated", timestamp });
  }

  handleExecCommandBegin(msg, timestamp) {
    if (!msg || typeof msg !== "object") {
      return;
    }
    const item = this.ensureToolItem(msg.call_id, timestamp);
    const commandText = formatCommand(msg.command ?? []);
    this.updateText(item, commandText || "Running command");
    const cwd = typeof msg.cwd === "string" ? msg.cwd : (msg.cwd ? String(msg.cwd) : "");
    this.setDetail(item, "cwd", "cwd", cwd);
    this.updateMeta(item, { status: "Running", timestamp });
  }

  handleExecCommandOutputDelta(msg, timestamp) {
    if (!msg || typeof msg !== "object") {
      return;
    }
    const decoded = decodeBase64Chunk(msg.chunk ?? "");
    if (!decoded) {
      return;
    }
    const item = this.ensureToolItem(msg.call_id, timestamp);
    const stream = msg.stream === "stderr" ? "stderr" : "stdout";
    this.appendCommandOutput(item, stream, decoded);
    this.updateMeta(item, { status: "Running", timestamp });
  }

  handleExecCommandEnd(msg, timestamp) {
    if (!msg || typeof msg !== "object") {
      return "Shell command finished.";
    }
    const item = this.ensureToolItem(msg.call_id, timestamp);
    if (msg.stdout && !item.stdoutText) {
      this.setCommandOutput(item, "stdout", msg.stdout);
    }
    if (msg.stderr && !item.stderrText) {
      this.setCommandOutput(item, "stderr", msg.stderr);
    }
    if (msg.aggregated_output && !item.stdoutText) {
      this.setCommandOutput(item, "stdout", msg.aggregated_output);
    }
    if (msg.formatted_output) {
      this.setNote(item, "formatted", msg.formatted_output, null);
    }
    const succeeded = typeof msg.exit_code === "number" ? msg.exit_code === 0 : false;
    const exitCode = typeof msg.exit_code === "number" ? String(msg.exit_code) : msg.exit_code ?? "";
    this.setDetail(item, "duration", "duration", msg.duration ?? "");
    this.setDetail(item, "exit", "exit code", exitCode);
    this.updateMeta(item, {
      status: succeeded ? "Command succeeded" : `Command failed (exit ${exitCode})`,
      timestamp,
    });
    return succeeded ? "Shell command finished." : "Shell command failed.";
  }

  handleExecApprovalRequest(msg, timestamp) {
    const item = this.addSystemMessage(
      "Approval required to run a command",
      null,
      timestamp,
      { label: "Approval" },
    );
    const commandText = msg && typeof msg === "object" ? formatCommand(msg.command ?? []) : "";
    if (commandText) {
      this.insertBeforeDetails(item, createPre(commandText, "event__code"));
    }
    if (msg && typeof msg === "object") {
      if (msg.reason) {
        this.setNote(item, "reason", msg.reason, null);
      }
      if (msg.cwd) {
        this.setDetail(item, "cwd", "cwd", msg.cwd);
      }
      if (msg.grant_root) {
        this.setDetail(item, "grant_root", "grant root", msg.grant_root);
      }
    }
    return "Codex requested exec approval.";
  }

  handlePatchApprovalRequest(msg, timestamp) {
    const item = this.addSystemMessage(
      "Approval required to apply a patch",
      null,
      timestamp,
      { label: "Approval" },
    );
    if (msg && typeof msg === "object") {
      if (msg.reason) {
        this.setNote(item, "reason", msg.reason, null);
      }
      if (msg.grant_root) {
        this.setDetail(item, "grant_root", "grant root", msg.grant_root);
      }
      const changes = changesToPaths(msg.changes);
      if (changes.length > 0) {
        const summary = `${changes.length} file${changes.length === 1 ? "" : "s"}`;
        this.setDetail(item, "files", "files", summary);
        this.setNote(item, "files_list", summarizeFileList(changes), null);
      }
    }
    return "Codex requested patch approval.";
  }

  handlePatchApplyBegin(msg, timestamp) {
    const item = this.addSystemMessage("Applying patch", null, timestamp, { label: "Patch" });
    if (msg && typeof msg === "object") {
      if (msg.auto_approved) {
        this.setDetail(item, "auto", "approval", "auto-approved");
      }
      const changes = changesToPaths(msg.changes);
      if (changes.length > 0) {
        const summary = `${changes.length} file${changes.length === 1 ? "" : "s"}`;
        this.setDetail(item, "files", "files", summary);
        this.setNote(item, "files_list", summarizeFileList(changes), null);
      }
    }
    this.updateMeta(item, { status: "Applying", timestamp });
    return "Applying patch…";
  }

  handlePatchApplyEnd(msg, timestamp) {
    const success = msg && typeof msg === "object" ? Boolean(msg.success) : false;
    const item = this.addSystemMessage(
      success ? "Patch applied successfully" : "Patch apply failed",
      null,
      timestamp,
      { label: "Patch" },
    );
    if (msg && typeof msg === "object") {
      if (msg.stdout) {
        this.insertBeforeDetails(item, createPre(msg.stdout, "event__code event__code--stdout"));
      }
      if (msg.stderr) {
        this.insertBeforeDetails(item, createPre(msg.stderr, "event__code event__code--stderr"));
      }
    }
    this.updateMeta(item, { status: success ? "Applied" : "Failed", timestamp });
    return success ? "Patch applied." : "Patch failed.";
  }

  formatInvocation(invocation) {
    if (!invocation || typeof invocation !== "object") {
      return "Tool call";
    }
    const { server, tool } = invocation;
    if (server && tool) {
      return `${server}/${tool}`;
    }
    if (tool) {
      return tool;
    }
    return String(server ?? "Tool call");
  }

  ensureToolCallItem(callId, timestamp, invocation) {
    const key = callId ? `toolcall:${callId}` : null;
    let item = key ? this.itemsById.get(key) ?? null : null;
    if (!item) {
      item = this.createItem("tool", key, timestamp, "Tool");
      if (invocation) {
        this.updateText(item, this.formatInvocation(invocation));
      }
    } else {
      this.updateMeta(item, { timestamp });
      if (invocation) {
        this.updateText(item, this.formatInvocation(invocation));
      }
    }
    if (callId) {
      this.setDetail(item, "call_id", "call id", callId);
    }
    return item;
  }

  handleMcpToolCallBegin(msg, timestamp) {
    if (!msg || typeof msg !== "object") {
      return "Tool call started.";
    }
    const item = this.ensureToolCallItem(msg.call_id, timestamp, msg.invocation);
    this.updateMeta(item, { status: "Running", timestamp });
    if (msg.invocation && typeof msg.invocation === "object" && msg.invocation.arguments) {
      this.insertBeforeDetails(
        item,
        createPre(formatJson(msg.invocation.arguments), "event__json"),
      );
    }
    return "Tool call started.";
  }

  handleMcpToolCallEnd(msg, timestamp) {
    if (!msg || typeof msg !== "object") {
      return "Tool call finished.";
    }
    const item = this.ensureToolCallItem(msg.call_id, timestamp, msg.invocation);
    let succeeded = true;
    if (msg.result && typeof msg.result === "object") {
      if ("Ok" in msg.result) {
        const okValue = msg.result.Ok;
        if (okValue && typeof okValue === "object" && okValue.isError === true) {
          succeeded = false;
        }
        this.insertBeforeDetails(
          item,
          createPre(formatJson(okValue ?? msg.result.Ok), "event__json"),
        );
      } else if ("Err" in msg.result) {
        const err = msg.result.Err;
        this.setNote(item, "tool_error", err ? String(err) : "Unknown tool error", "error");
        succeeded = false;
      }
    }
    if (msg.duration) {
      this.setDetail(item, "duration", "duration", msg.duration);
    }
    this.updateMeta(item, {
      status: succeeded ? "Tool succeeded" : "Tool failed",
      timestamp,
    });
    return succeeded ? "Tool call finished." : "Tool call failed.";
  }

  handleWebSearchBegin(msg, timestamp) {
    const query = msg && typeof msg === "object" ? msg.query ?? "" : "";
    const item = this.addSystemMessage("Web search started", query, timestamp, { label: "Search" });
    this.updateMeta(item, { status: "Running", timestamp });
    return query ? `Searching the web: ${query}` : "Web search started.";
  }

  handleWebSearchEnd(msg, timestamp) {
    const query = msg && typeof msg === "object" ? msg.query ?? "" : "";
    const item = this.addSystemMessage("Web search complete", query, timestamp, { label: "Search" });
    this.updateMeta(item, { status: "Done", timestamp });
    return query ? `Web search finished: ${query}` : "Web search finished.";
  }

  handleViewImageToolCall(msg, timestamp) {
    const path = msg && typeof msg === "object" ? msg.path ?? "" : "";
    const text = path ? `Opened image ${path}` : "Opened image";
    this.addSystemMessage("View image", text, timestamp, { label: "Image" });
    return text;
  }

  handleStreamInfo(msg, timestamp) {
    const message = msg && typeof msg === "object" ? msg.message ?? "" : "";
    this.addSystemMessage("Stream info", message, timestamp, { label: "Info" });
    return message ? `Stream info: ${message}` : "Stream info.";
  }

  handleSessionConfigured(msg, timestamp) {
    if (!msg || typeof msg !== "object") {
      return;
    }
    const item = this.addSystemMessage("Session configured", null, timestamp, { label: "Session" });
    if (msg.model) {
      this.setDetail(item, "model", "model", msg.model);
    }
    if (msg.session_id) {
      this.setDetail(item, "session", "session id", msg.session_id);
    }
    if (msg.reasoning_effort) {
      this.setDetail(item, "effort", "reasoning effort", msg.reasoning_effort);
    }
    if (msg.history_log_id !== undefined) {
      this.setDetail(item, "history_log", "history log id", String(msg.history_log_id));
    }
    if (msg.history_entry_count !== undefined) {
      this.setDetail(
        item,
        "history_entries",
        "history entries",
        String(msg.history_entry_count),
      );
    }
    this.updateMeta(item, { status: "Ready", timestamp });
  }

  handleConversationPath(msg, timestamp) {
    const path = msg && typeof msg === "object" ? msg.path ?? "" : "";
    this.addSystemMessage("Conversation files saved", path, timestamp, { label: "Files" });
    return "Conversation files available.";
  }

  handleEnteredReviewMode(timestamp) {
    this.addSystemMessage("Entered review mode", null, timestamp, { label: "Review" });
    return "Codex entered review mode.";
  }

  handleExitedReviewMode(msg, timestamp) {
    const item = this.addSystemMessage("Exited review mode", null, timestamp, { label: "Review" });
    if (msg && typeof msg === "object" && msg.review_output) {
      this.insertBeforeDetails(item, createPre(formatJson(msg.review_output), "event__json"));
    }
    return "Codex exited review mode.";
  }

  handleStreamError(msg, timestamp) {
    const message = msg && typeof msg === "object" && msg.message ? msg.message : "Unknown stream error";
    this.addErrorMessage("Stream error", message, timestamp);
    return `Stream error: ${message}`;
  }

  handlePlanUpdate(msg, timestamp) {
    const item = this.addSystemMessage(
      "Plan updated",
      msg && typeof msg === "object" ? msg.explanation ?? null : null,
      timestamp,
      { label: "Plan" },
    );
    const planItems = msg && typeof msg === "object" && Array.isArray(msg.plan) ? msg.plan : [];
    if (planItems.length > 0) {
      const list = document.createElement("ul");
      list.className = "event__plan";
      for (const step of planItems) {
        const li = document.createElement("li");
        const status = typeof step.status === "string" ? step.status : "pending";
        li.textContent = `${formatPlanStatus(status)} ${step.step ?? ""}`;
        list.appendChild(li);
      }
      this.insertBeforeDetails(item, list);
    }
    this.updateMeta(item, { status: "Updated", timestamp });
    return "Plan updated.";
  }

  handleTurnDiff(msg, timestamp) {
    const item = this.addSystemMessage("Turn diff", null, timestamp, { label: "Diff" });
    const diff = msg && typeof msg === "object" ? msg.unified_diff ?? "" : "";
    if (diff) {
      this.insertBeforeDetails(item, createPre(diff, "event__code event__code--diff"));
    }
  }

  handleTurnAborted(msg, timestamp) {
    const reasonRaw = msg && typeof msg === "object" ? msg.reason ?? "" : "";
    const pretty = reasonRaw.replace(/_/g, " ");
    this.addSystemMessage("Turn aborted", pretty || "Codex aborted the turn.", timestamp, { label: "Task" });
    return "Codex aborted the turn.";
  }

  handleBackgroundEvent(msg, params, timestamp) {
    const message =
      (msg && typeof msg === "object" && msg.message) ||
      (params && typeof params === "object" && params.summary) ||
      "";
    this.addSystemMessage("Background event", message, timestamp, { label: "Info" });
  }

  fallbackGeneric(type, params, timestamp) {
    const pretty = type.replace(/_/g, " ");
    const item = this.addSystemMessage(`Event: ${pretty}`, null, timestamp);
    if (params && typeof params === "object" && params.msg) {
      this.insertBeforeDetails(item, this.createJsonBlock(params.msg));
    }
  }

  resolveEventType(method, msg) {
    if (msg && typeof msg === "object" && typeof msg.type === "string") {
      return msg.type;
    }
    const prefix = "codex/event/";
    if (typeof method === "string" && method.startsWith(prefix)) {
      return method.slice(prefix.length);
    }
    return method ?? "unknown";
  }

  handleCodexEvent(method, params, timestamp) {
    const msg = params && typeof params === "object" ? params.msg : undefined;
    const id = params && typeof params === "object" ? params.id : undefined;
    const type = this.resolveEventType(method, msg);

    switch (type) {
      case "agent_reasoning_delta":
      case "agent_reasoning_raw_content_delta":
        return this.handleAgentReasoningDelta(id, msg?.delta ?? "", timestamp);
      case "agent_reasoning":
      case "agent_reasoning_raw_content":
        this.handleAgentReasoning(id, msg?.text ?? "", timestamp);
        return undefined;
      case "agent_reasoning_section_break":
        this.handleAgentReasoningDelta(id, "\n\n", timestamp);
        return undefined;
      case "agent_message_delta":
        return this.handleAgentMessageDelta(id, msg?.delta ?? "", timestamp);
      case "agent_message": {
        const text = this.handleAgentMessage(id, msg?.message ?? "", timestamp);
        return summarizeAgentMessageForStatus(text);
      }
      case "session_configured":
        this.handleSessionConfigured(msg, timestamp);
        return "Codex session configured.";
      case "user_message":
        this.handleUserMessage(id, msg, timestamp);
        return undefined;
      case "task_started":
        this.addSystemMessage("Task started", params?.summary ?? null, timestamp, { label: "Task" });
        return "Codex started working…";
      case "task_complete":
        return this.handleTaskComplete(msg, timestamp);
      case "token_count":
        this.handleTokenCount(msg, timestamp);
        return undefined;
      case "error": {
        const message = msg?.message ?? "Unknown error";
        this.addErrorMessage("Error", message, timestamp);
        return `Error: ${message}`;
      }
      case "exec_command_begin":
        this.handleExecCommandBegin(msg, timestamp);
        return "Running shell command…";
      case "exec_command_output_delta":
        this.handleExecCommandOutputDelta(msg, timestamp);
        return undefined;
      case "exec_command_end":
        return this.handleExecCommandEnd(msg, timestamp);
      case "exec_approval_request":
        return this.handleExecApprovalRequest(msg, timestamp);
      case "apply_patch_approval_request":
        return this.handlePatchApprovalRequest(msg, timestamp);
      case "patch_apply_begin":
        return this.handlePatchApplyBegin(msg, timestamp);
      case "patch_apply_end":
        return this.handlePatchApplyEnd(msg, timestamp);
      case "mcp_tool_call_begin":
        return this.handleMcpToolCallBegin(msg, timestamp);
      case "mcp_tool_call_end":
        return this.handleMcpToolCallEnd(msg, timestamp);
      case "web_search_begin":
        return this.handleWebSearchBegin(msg, timestamp);
      case "web_search_end":
        return this.handleWebSearchEnd(msg, timestamp);
      case "view_image_tool_call":
        return this.handleViewImageToolCall(msg, timestamp);
      case "background_event":
        this.handleBackgroundEvent(msg, params, timestamp);
        return undefined;
      case "stream_error":
        return this.handleStreamError(msg, timestamp);
      case "stream_info":
        return this.handleStreamInfo(msg, timestamp);
      case "plan_update":
        return this.handlePlanUpdate(msg, timestamp);
      case "turn_diff":
        this.handleTurnDiff(msg, timestamp);
        return undefined;
      case "turn_aborted":
        return this.handleTurnAborted(msg, timestamp);
      case "conversation_path":
        return this.handleConversationPath(msg, timestamp);
      case "entered_review_mode":
        return this.handleEnteredReviewMode(timestamp);
      case "exited_review_mode":
        return this.handleExitedReviewMode(msg, timestamp);
      case "shutdown_complete":
        this.addSystemMessage("Codex shut down", null, timestamp, { label: "System" });
        return "Codex shut down.";
      default:
        this.fallbackGeneric(type, params, timestamp);
        return undefined;
    }
  }
}

const conversationRenderer = new ConversationRenderer(eventFeed);

updateApprovalEmptyState();

function removeApprovalRequest(requestId) {
  const entry = pendingApprovalRequests.get(requestId);
  if (!entry) {
    return;
  }
  entry.element.remove();
  pendingApprovalRequests.delete(requestId);
  updateApprovalEmptyState();
}

function addExecApprovalRequest(requestId, params, requestedAt) {
  if (!approvalList) {
    return;
  }

  removeApprovalRequest(requestId);

  const card = document.createElement("div");
  card.className = "approval-card";

  const title = document.createElement("div");
  title.className = "approval-card__title";
  title.textContent = "Command approval requested";
  card.appendChild(title);

  const commandText = formatCommand(Array.isArray(params?.command) ? params.command : []);
  if (commandText) {
    const commandEl = document.createElement("div");
    commandEl.className = "approval-card__command";
    commandEl.textContent = commandText;
    card.appendChild(commandEl);
  }

  const metaItems = [];
  if (params?.reason) {
    metaItems.push(params.reason);
  }
  if (params?.cwd) {
    metaItems.push(`cwd: ${params.cwd}`);
  }
  if (requestedAt) {
    metaItems.push(`requested at ${requestedAt}`);
  }
  if (metaItems.length > 0) {
    const meta = document.createElement("div");
    meta.className = "approval-card__meta";
    meta.textContent = metaItems.join(" • ");
    card.appendChild(meta);
  }

  const actions = document.createElement("div");
  actions.className = "approval-card__actions";
  card.appendChild(actions);

  const buttons = [];
  const buttonConfigs = [
    { label: "Approve", decision: "approved", variant: "approve" },
    { label: "Approve for Session", decision: "approved_for_session", variant: "session" },
    { label: "Deny", decision: "denied", variant: "deny" },
    { label: "Abort Task", decision: "abort", variant: "abort" },
  ];

  const entry = {
    element: card,
    buttons,
    params: params ?? {},
    commandText,
  };
  pendingApprovalRequests.set(requestId, entry);

  for (const config of buttonConfigs) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.variant = config.variant;
    button.textContent = config.label;
    button.addEventListener("click", () => {
      handleExecApprovalDecision(requestId, config.decision);
    });
    actions.appendChild(button);
    buttons.push(button);
  }

  approvalList.appendChild(card);
  updateApprovalEmptyState();
  setStatus("Command approval requested. Review pending approvals.");
}

function handleExecApprovalDecision(requestId, decision) {
  const entry = pendingApprovalRequests.get(requestId);
  if (!entry) {
    return;
  }
  for (const button of entry.buttons) {
    button.disabled = true;
  }

  const timestamp = new Date().toLocaleTimeString();
  try {
    window.codexBridge.respond(requestId, { decision });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    conversationRenderer.addErrorMessage("Failed to respond to approval", message, timestamp);
    setStatus(`Failed to respond to approval: ${message}`);
    for (const button of entry.buttons) {
      button.disabled = false;
    }
    return;
  }

  const decisionLabel = formatDecisionLabel(decision);
  const item = conversationRenderer.addSystemMessage(
    `Command ${decisionLabel}`,
    null,
    timestamp,
    { label: "Approval" },
  );
  if (entry.commandText) {
    conversationRenderer.insertBeforeDetails(item, createPre(entry.commandText, "event__code"));
  }
  if (entry.params?.reason) {
    conversationRenderer.setNote(item, "reason", entry.params.reason, null);
  }
  if (entry.params?.cwd) {
    conversationRenderer.setDetail(item, "cwd", "cwd", entry.params.cwd);
  }

  removeApprovalRequest(requestId);
  setStatus(`Command ${decisionLabel}. Waiting for Codex…`);
}

function handleServerRequest(request, timestamp) {
  if (!request || typeof request !== "object") {
    return false;
  }
  const method = request.method;
  if (method === "execCommandApproval") {
    addExecApprovalRequest(request.id, request.params ?? {}, timestamp);
    return true;
  }
  if (method === "applyPatchApproval") {
    conversationRenderer.addSystemMessage(
      "Patch approval requested",
      request.params ?? {},
      timestamp,
      { label: "Approval" },
    );
    try {
      window.codexBridge.respond(request.id, { decision: "denied" });
      setStatus("Automatically denied patch approval (not yet supported).");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      conversationRenderer.addErrorMessage(
        "Failed to respond to patch approval",
        message,
        timestamp,
      );
      setStatus(`Failed to respond to patch approval: ${message}`);
    }
    return true;
  }
  return false;
}

function setStatus(text) {
  statusLine.textContent = text;
}

function setConversationId(id) {
  conversationLine.textContent = id ? `Conversation: ${id}` : "Conversation: —";
}

function buildNewConversationParams() {
  const params = {
    approvalPolicy: "on-request",
  };
  const cwdValue = cwdInput ? cwdInput.value.trim() : "";
  if (cwdValue) {
    params.cwd = cwdValue;
  }
  const sandboxValue = sandboxSelect?.value ?? "read-only";
  params.sandboxPolicy = sandboxSelectionToPolicy(sandboxValue);
  return params;
}

startButton.addEventListener("click", async () => {
  const now = () => new Date().toLocaleTimeString();
  try {
    startButton.disabled = true;
    sendButton.disabled = true;
    setStatus("Creating conversation…");
    clearPendingApprovalRequests();

    if (activeSubscriptionId) {
      try {
        const response = await window.codexBridge.removeConversationListener({
          subscriptionId: activeSubscriptionId,
        });
        conversationRenderer.addSystemMessage(
          "Removed conversation listener",
          response?.result ?? {},
          now(),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        conversationRenderer.addErrorMessage(
          "removeConversationListener failed",
          message,
          now(),
        );
      }
      activeSubscriptionId = null;
    }

    const conversationConfig = buildNewConversationParams();
    const response = await window.codexBridge.newConversation(conversationConfig);
    conversationRenderer.addSystemMessage("Conversation settings", conversationConfig, now(), {
      label: "Session",
    });
    const result = response?.result ?? {};
    activeConversationId = typeof result.conversationId === "string" ? result.conversationId : null;
    setConversationId(activeConversationId);
    conversationRenderer.addSystemMessage("Started new conversation", result, now());

    if (activeConversationId) {
      setStatus("Subscribing to Codex events…");
      try {
        const listenerResponse = await window.codexBridge.addConversationListener({
          conversationId: activeConversationId,
        });
        const listenerResult = listenerResponse?.result ?? {};
        conversationRenderer.addSystemMessage("Subscribed to conversation events", listenerResult, now());
        const maybeSubscription =
          listenerResult && typeof listenerResult === "object"
            ? listenerResult.subscriptionId
            : undefined;
        if (typeof maybeSubscription === "string" && maybeSubscription.length > 0) {
          activeSubscriptionId = maybeSubscription;
          sendButton.disabled = false;
          setStatus("Conversation ready. Type a prompt and send it to Codex.");
        } else {
          setStatus("Conversation ready, but failed to subscribe to events.");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        conversationRenderer.addErrorMessage(
          "Failed to subscribe to conversation events",
          message,
          now(),
        );
        setStatus(`Failed to subscribe to conversation events: ${message}`);
      }
    } else {
      setStatus("Conversation did not return an id.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    conversationRenderer.addErrorMessage("Failed to create conversation", message, new Date().toLocaleTimeString());
    setStatus(`Failed to create conversation: ${message}`);
  } finally {
    startButton.disabled = false;
  }
});

sendButton.addEventListener("click", async () => {
  if (!activeConversationId) {
    return;
  }
  if (!activeSubscriptionId) {
    setStatus("Conversation not subscribed yet. Click Start Conversation first.");
    return;
  }

  const text = userInput.value.trim();
  if (!text) {
    setStatus("Enter a message before sending.");
    return;
  }

  let pendingItem = null;
  try {
    sendButton.disabled = true;
    setStatus("Sending user message…");
    pendingItem = conversationRenderer.addLocalUserMessage(text);
    await window.codexBridge.sendUserMessage({
      conversationId: activeConversationId,
      items: [{ type: "text", data: { text } }],
    });
    conversationRenderer.markUserMessageQueued(pendingItem);
    userInput.value = "";
    setStatus("User message queued. Waiting for Codex events…");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (pendingItem) {
      conversationRenderer.markUserMessageFailed(pendingItem, message);
    }
    conversationRenderer.addErrorMessage("Failed to send message", message, new Date().toLocaleTimeString());
    setStatus(`Failed to send message: ${message}`);
  } finally {
    sendButton.disabled = false;
  }
});

if (browseCwdButton && cwdInput) {
  browseCwdButton.addEventListener("click", async () => {
    try {
      const selected = await window.codexBridge.selectDirectory();
      if (typeof selected === "string" && selected.length > 0) {
        cwdInput.value = selected;
        setStatus(`Working directory set to ${selected}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      conversationRenderer.addErrorMessage(
        "Failed to choose working directory",
        message,
        new Date().toLocaleTimeString(),
      );
      setStatus(`Failed to choose working directory: ${message}`);
    }
  });
}

window.codexBridge.onReady(({ initialized: ready, defaultCwd }) => {
  initialized = ready;
  if (ready && typeof defaultCwd === "string" && defaultCwd.length > 0 && cwdInput && !cwdInput.value) {
    cwdInput.value = defaultCwd;
  }
  setStatus(
    ready
      ? 'App server ready. Click "Start Conversation".'
      : "App server not initialized.",
  );
});

window.codexBridge.onRaw((line) => {
  appendListItem(logFeed, createInlineCode(line));
});

window.codexBridge.onError((message) => {
  conversationRenderer.addErrorMessage("Bridge error", message, new Date().toLocaleTimeString());
  setStatus(`Error: ${message}`);
});

window.codexBridge.onExit(({ code, signal }) => {
  const detail = `code=${code ?? "null"}, signal=${signal ?? "null"}`;
  conversationRenderer.addSystemMessage("Codex app server exited", detail, new Date().toLocaleTimeString());
  setStatus("Codex app server exited");
  startButton.disabled = true;
  sendButton.disabled = true;
  activeConversationId = null;
  activeSubscriptionId = null;
  setConversationId(null);
  clearPendingApprovalRequests();
});

window.codexBridge.onMessage(({ message, raw }) => {
  const timestamp = new Date().toLocaleTimeString();
  if (message?.kind === "notification") {
    const { method, params } = message.notification;
    if (typeof method === "string" && method.startsWith("codex/event/")) {
      const statusUpdate = conversationRenderer.handleCodexEvent(method, params ?? {}, timestamp);
      if (statusUpdate) {
        setStatus(statusUpdate);
      }
      return;
    }
    conversationRenderer.addSystemMessage(`Notification: ${method}`, params ?? {}, timestamp);
    return;
  }

  if (message?.kind === "response") {
    const { id, result } = message.response;
    conversationRenderer.addSystemMessage(
      `Response #${id}`,
      result ?? {},
      timestamp,
    );
    return;
  }

  if (message?.kind === "error") {
    const { id, error: rpcError } = message.error;
    const errorMessage = rpcError?.message ?? "Unknown error";
    conversationRenderer.addErrorMessage(
      `Error #${id}`,
      rpcError ?? errorMessage,
      timestamp,
    );
    setStatus(`Error: ${errorMessage}`);
    return;
  }

  if (message?.kind === "request") {
    if (handleServerRequest(message.request, timestamp)) {
      return;
    }
    const fallbackMethod = message?.request?.method ?? "unknown";
    conversationRenderer.addSystemMessage(
      `Request: ${fallbackMethod}`,
      message?.request?.params ?? {},
      timestamp,
    );
    return;
  }

  const encoded = formatJson(raw ?? message);
  conversationRenderer.addSystemMessage(
    "Message",
    createPre(encoded, "event__json"),
    timestamp,
  );
});

if (!initialized) {
  setStatus("Waiting for Codex app server…");
}
