import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";

import {
	type AssistantMessage,
	type AssistantMessageEventStream,
	createAssistantMessageEventStream,
	createProvider,
	type Message,
	type Model,
	type Provider,
	type TextContent,
	type ThinkingContent,
} from "@earendil-works/pi-ai";

/**
 * A local agent Ace drives over ACP on its stdio: `name` is its model id under `acp/`, and
 * `command` is the argv that starts it in ACP mode, such as ["claude", "acp"].
 */
export type AcpClient = { name: string; command: [string, ...string[]] };

const PROVIDER = "acp";

function model(client: AcpClient): Model<"acp"> {
	return {
		id: client.name,
		name: client.name,
		api: PROVIDER,
		provider: PROVIDER,
		baseUrl: `stdio://${client.command[0]}`,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		reasoning: false,
		contextWindow: 200_000,
		maxTokens: 32_000,
	};
}

const usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

type Response = { id: number; result?: unknown; error?: { message: string } };
type Update = {
	sessionId: string;
	update: {
		sessionUpdate: string;
		content?: { type: string; text?: string };
		title?: string;
	};
};

class Connection {
	#next = 1;
	#pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();

	constructor(
		private child: ReturnType<typeof spawn>,
		private update: (value: Update) => void,
		private name: string,
		noise: (line: string) => void,
	) {
		const lines = createInterface({ input: child.stdout! });
		lines.on("line", (line) => {
			let value: Response & { method?: string; params?: unknown };
			try {
				value = JSON.parse(line);
			} catch {
				// A client that writes anything else to stdout, such as logs, leaves it as diagnostics.
				return noise(line);
			}
			this.#receive(value);
		});
		// Writes into a process that failed to spawn error the stream; the child's error reports it.
		child.stdin!.on("error", () => {});
		child.on("error", (error) => this.#fail(error));
		child.on("exit", () => this.#fail(new Error(`${this.name} exited`)));
	}

	#fail(error: Error) {
		for (const pending of this.#pending.values()) pending.reject(error);
		this.#pending.clear();
	}

	#send(value: unknown) {
		this.child.stdin!.write(`${JSON.stringify(value)}\n`);
	}

	#receive(value: Response & { method?: string; params?: unknown }) {
		if (value.method === "session/update") return this.update(value.params as Update);
		if (value.method === "session/request_permission") {
			const params = value.params as {
				options?: { optionId: string; kind: string }[];
			};
			const options = params.options || [];
			const option = options.find((item) => item.kind === "allow_always")
				|| options.find((item) => item.kind === "allow_once");
			return this.#send({
				jsonrpc: "2.0",
				id: value.id,
				result: {
					outcome: option
						? { outcome: "selected", optionId: option.optionId }
						: { outcome: "cancelled" },
				},
			});
		}
		if (value.id === undefined) return;
		const pending = this.#pending.get(value.id);
		if (!pending) return;
		this.#pending.delete(value.id);
		if (value.error) pending.reject(new Error(value.error.message));
		else pending.resolve(value.result);
	}

	request<T>(method: string, params: unknown, signal?: AbortSignal): Promise<T> {
		const id = this.#next++;
		return new Promise<T>((resolve, reject) => {
			this.#pending.set(id, { resolve: (value) => resolve(value as T), reject });
			this.#send({ jsonrpc: "2.0", id, method, params });
			signal?.addEventListener(
				"abort",
				() => this.#send({ jsonrpc: "2.0", method: "$/cancel_request", params: { requestId: id } }),
				{ once: true },
			);
		});
	}

	notify(method: string, params: unknown) {
		this.#send({ jsonrpc: "2.0", method, params });
	}
}

function content(value: Message["content"]): string {
	if (typeof value === "string") return value;
	return value.flatMap((block) => {
		if (block.type === "text") return [block.text];
		if (block.type === "thinking") return [`<thinking>${block.thinking}</thinking>`];
		if (block.type === "toolCall") {
			return [`<tool name="${block.name}">${JSON.stringify(block.arguments)}</tool>`];
		}
		if (block.type === "image") return ["[image]"];
		return [];
	}).join("\n");
}

function transcript(messages: readonly Message[]): string {
	return messages.map((item) => {
		if (item.role === "system") {
			const sections = Object.values(item.sections || {}).filter((value) => value !== null);
			return `<system>\n${
				[content(item.content), ...sections].filter(Boolean).join("\n\n")
			}\n</system>`;
		}
		if (item.role === "toolResult") {
			return `<tool-result name="${item.toolName}">\n${content(item.content)}\n</tool-result>`;
		}
		return `<${item.role}>\n${content(item.content)}\n</${item.role}>`;
	}).join("\n\n");
}

/** The most recent session this client answered in, so follow-ups load it rather than start over. */
function previous(messages: readonly Message[], model: string) {
	for (let index = messages.length - 1; index >= 0; index--) {
		const item = messages[index]!;
		if (
			item.role === "assistant" && item.provider === PROVIDER && item.model === model
			&& item.responseId
		) return { session: item.responseId, after: index + 1 };
	}
	return { session: undefined, after: 0 };
}

function message(model: string, session?: string): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: PROVIDER,
		provider: PROVIDER,
		model,
		...(session ? { responseId: session } : {}),
		usage: structuredClone(usage),
		stopReason: "pending",
		timestamp: Date.now(),
	};
}

function stop(child: ReturnType<typeof spawn>, tree = false) {
	if (!tree || !child.pid) return child.kill();
	if (process.platform === "win32") {
		const result = spawnSync("taskkill", ["/pid", `${child.pid}`, "/t", "/f"], {
			stdio: "ignore",
		});
		if (!result.error) return true;
		return child.kill();
	}
	const result = spawnSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" });
	const children = new Map<number, number[]>();
	for (const line of result.stdout.split("\n")) {
		const [pid, parent] = line.trim().split(/\s+/).map(Number);
		if (!pid || !parent) continue;
		const values = children.get(parent) || [];
		values.push(pid);
		children.set(parent, values);
	}
	const descendants: number[] = [];
	const collect = (parent: number) => {
		for (const pid of children.get(parent) || []) {
			collect(pid);
			descendants.push(pid);
		}
	};
	collect(child.pid);
	for (const pid of descendants) {
		try {
			process.kill(pid);
		} catch {}
	}
	try {
		process.kill(-child.pid);
		return true;
	} catch {
		return child.kill();
	}
}

function run(
	client: AcpClient,
	cwd: string,
	request: { messages: readonly Message[] },
	options: { signal?: AbortSignal } | undefined,
	events: AssistantMessageEventStream,
) {
	void (async () => {
		const title = client.name[0]!.toUpperCase() + client.name.slice(1);
		const child = spawn(client.command[0], client.command.slice(1), {
			detached: process.platform !== "win32",
			stdio: ["pipe", "pipe", "pipe"],
		});
		// A client's stderr explains failures its JSON-RPC errors don't, such as missing auth.
		let stderr = "";
		const noise = (line: string) => {
			stderr = `${stderr}${line}\n`.slice(-4096);
		};
		child.stderr?.on("data", (chunk) => noise(String(chunk)));
		const prior = previous(request.messages, client.name);
		let session = prior.session;
		let active = false;
		let partial: AssistantMessage | undefined;
		let answer: TextContent | undefined;
		let thought: ThinkingContent | undefined;
		let aborted = false;
		const append = (kind: "text" | "thinking", delta: string) => {
			if (!partial || !delta) return;
			const block = kind === "text"
				? answer ||= { type: "text", text: "" }
				: thought ||= { type: "thinking", thinking: "" };
			if (!partial.content.includes(block)) {
				partial.content.push(block);
				events.push({
					type: kind === "text" ? "text_start" : "thinking_start",
					contentIndex: partial.content.length - 1,
					partial,
				});
			}
			if (block.type === "text") block.text += delta;
			else block.thinking += delta;
			events.push({
				type: kind === "text" ? "text_delta" : "thinking_delta",
				contentIndex: partial.content.indexOf(block),
				delta,
				partial,
			});
		};
		const connection = new Connection(
			child,
			({ sessionId, update }) => {
				if (!active || sessionId !== session) return;
				if (
					update.sessionUpdate === "agent_message_chunk" && update.content?.type === "text"
				) append("text", update.content.text || "");
				if (
					update.sessionUpdate === "agent_thought_chunk" && update.content?.type === "text"
				) append("thinking", update.content.text || "");
				if (update.sessionUpdate === "tool_call") append("thinking", `\n${update.title}\n`);
			},
			title,
			noise,
		);
		const cancel = () => {
			aborted = true;
			if (session) connection.notify("session/cancel", { sessionId: session });
		};
		options?.signal?.addEventListener("abort", cancel, { once: true });
		try {
			const initialized = await connection.request<{
				protocolVersion: number;
				agentCapabilities?: { loadSession?: boolean };
			}>("initialize", {
				protocolVersion: 1,
				clientCapabilities: {},
				clientInfo: { name: "ace", version: "0" },
			});
			if (initialized.protocolVersion !== 1) {
				throw new Error(`${title} uses unsupported ACP version ${initialized.protocolVersion}`);
			}
			if (session && initialized.agentCapabilities?.loadSession) {
				try {
					await connection.request("session/load", { sessionId: session, cwd, mcpServers: [] });
				} catch {
					session = undefined;
				}
			}
			if (!session) {
				const created = await connection.request<{ sessionId: string }>("session/new", {
					cwd,
					mcpServers: [],
				});
				session = created.sessionId;
			}
			partial = message(client.name, session);
			events.push({ type: "start", partial });
			active = true;
			const prompt = transcript(
				request.messages.slice(prior.session === session ? prior.after : 0),
			);
			const result = await connection.request<{ stopReason: string }>(
				"session/prompt",
				{ sessionId: session, prompt: [{ type: "text", text: prompt }] },
				options?.signal,
			);
			if (!partial) throw new Error(`${title} ended before starting its response`);
			if (result.stopReason === "cancelled") {
				return events.push({
					type: "error",
					reason: "aborted",
					error: { ...partial, stopReason: "aborted" },
				});
			}
			if (result.stopReason === "refusal") {
				return events.push({
					type: "error",
					reason: "error",
					error: { ...partial, stopReason: "error", errorMessage: `${title} refused the request` },
				});
			}
			const reason = result.stopReason === "end_turn" ? "stop" : "length";
			events.push({
				type: "done",
				reason,
				message: { ...partial, stopReason: reason },
			});
		} catch (error) {
			const aborted = !!options?.signal?.aborted;
			let text = error instanceof Error ? error.message : String(error);
			const detail = stderr.trim().split("\n").findLast((line) => line.trim())?.trim();
			if (detail && !text.includes(detail)) text = `${text}: ${detail}`;
			if (/auth|required|log.?in|credential/i.test(text)) {
				text = `${title} needs authentication. Sign in to it, then try again.`;
			}
			events.push({
				type: "error",
				reason: aborted ? "aborted" : "error",
				error: {
					...message(client.name, session),
					stopReason: aborted ? "aborted" : "error",
					errorMessage: text,
				},
			});
		} finally {
			active = false;
			options?.signal?.removeEventListener("abort", cancel);
			stop(child, aborted);
		}
	})();
}

export function acpProvider(clients: readonly AcpClient[], cwd = process.cwd()): Provider<"acp"> {
	const streamSimple = (
		selected: Model<"acp">,
		context: { messages: readonly Message[] },
		options?: { signal?: AbortSignal },
	) => {
		const events = createAssistantMessageEventStream();
		const client = clients.find((value) => value.name === selected.id);
		if (!client) {
			events.push({
				type: "error",
				reason: "error",
				error: {
					...message(selected.id),
					stopReason: "error",
					errorMessage: `This host has no ACP client named ${selected.id}.`,
				},
			});
			return events;
		}
		run(client, cwd, context, options, events);
		return events;
	};
	return createProvider({
		id: PROVIDER,
		name: "ACP",
		auth: {
			apiKey: {
				name: "ACP client",
				async resolve() {
					return { auth: {}, source: "Ace settings" };
				},
			},
		},
		models: clients.map(model),
		api: { stream: streamSimple, streamSimple },
	});
}
