import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ModelRef } from "@ace/channel/protocol";

import type { AcpClient } from "./acp";
import { config } from "./config";
import * as directory from "./directory";
import type { Compute } from "./protocol";

export function isModel(value: unknown): value is ModelRef {
	return typeof value === "object" && value !== null && "provider" in value && "modelId" in value
		&& typeof value.provider === "string" && value.provider.length > 0
		&& typeof value.modelId === "string" && value.modelId.length > 0;
}

type Saved = { model?: ModelRef | null; compute?: Compute; folder?: string; acp?: AcpClient[] };

function saved(): Saved {
	let text: string;
	try {
		text = readFileSync(join(config.settings, "settings.json"), "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw error;
	}
	const value: unknown = JSON.parse(text);
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("Ace settings must contain a settings object");
	}
	return value as Saved;
}

export function preference(): ModelRef | null {
	const { model } = saved();
	if (model === undefined || model === null) return null;
	if (!isModel(model)) throw new Error("The default model in Ace settings is invalid");
	return model;
}

/** A host's saved setting wins; otherwise the team's directory may name the service, which turns it on. */
export function compute(): Compute {
	const own = saved().compute;
	if (own) return own;
	const team = directory.read().compute;
	return team ? { enabled: true, url: team } : { enabled: false, url: null };
}

/** Kept as entered, with `~` unexpanded, so the app shows and suggests paths the way people type them. */
export function folder(): string {
	return saved().folder || "~/code";
}

function save(patch: Saved): void {
	const next = { ...saved(), ...patch };
	mkdirSync(config.settings, { recursive: true, mode: 0o700 });
	const temporary = join(config.settings, `.settings-${randomUUID()}.json`);
	try {
		writeFileSync(temporary, `${JSON.stringify(next, null, "\t")}\n`, { mode: 0o600 });
		renameSync(temporary, join(config.settings, "settings.json"));
	} finally {
		rmSync(temporary, { force: true });
	}
}

export function savePreference(model: ModelRef | null): void {
	if (model !== null && !isModel(model)) throw new Error("Choose a provider and model");
	save({ model });
}

export function saveCompute(value: Compute): void {
	save({ compute: value });
}

export function saveFolder(value: string): void {
	save({ folder: value });
}

/** An ACP client's name becomes the model id in `acp/<name>`; ids stay lowercase kebab-case. */
const CLIENT = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export function isAcpClient(value: unknown): value is AcpClient {
	return typeof value === "object" && value !== null
		&& "name" in value && typeof value.name === "string" && CLIENT.test(value.name)
		&& "command" in value && Array.isArray(value.command) && value.command.length > 0
		&& value.command.every((arg) => typeof arg === "string" && arg.length > 0);
}

/** Local agents this host runs over ACP, saved as `acp` in settings.json. */
export function acp(): AcpClient[] {
	const { acp } = saved();
	if (acp === undefined) return [];
	if (
		!Array.isArray(acp) || !acp.every(isAcpClient)
		|| new Set(acp.map((client) => client.name)).size !== acp.length
	) {
		throw new Error("An ACP client in Ace settings is invalid");
	}
	return acp;
}

export function saveAcp(clients: AcpClient[]): void {
	save({ acp: clients });
}
