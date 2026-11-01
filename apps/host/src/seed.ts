import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import { Channel, type Seed, shiftTo, validateSeed } from "@ace/channel";

import * as catalog from "./catalog";
import { Connection } from "./client";
import { models } from "./keys";
import { log } from "./log";
import { project } from "./manage";

/** Runs `use` on a channel opened in this process before it is listed, so no worker runs it yet. */
export async function offline<T>(
	record: catalog.Listing,
	use: (channel: Channel) => Promise<T>,
	relocate?: boolean,
): Promise<T> {
	const envs: NodeExecutionEnv[] = [];
	const channel = await Channel.open({
		id: record.id,
		name: record.name,
		prefix: record.prefix,
		named: record.named,
		owner: record.owner,
		project: record.project,
		model: record.model,
		...(relocate ? { relocate } : {}),
		storage: await openNodeSqliteStorage(catalog.paths(record.id).storage),
		models: models(record.project),
		env(cwd) {
			const env = new NodeExecutionEnv({ cwd });
			envs.push(env);
			return env;
		},
		directory: {
			self: { id: record.id, name: record.prefix },
			list: async () => [],
			deliver: async () => {
				throw new Error("A channel that isn't listed yet delivers nothing");
			},
		},
		log,
	});
	try {
		return await use(channel);
	} finally {
		await channel.close();
		for (const env of envs) await env.cleanup(BACKGROUND_CONTEXT);
	}
}

/** A local channel's chats as a seed file, read through its worker so it can keep running. */
export async function exportSeed(record: catalog.Listing, file: string): Promise<string> {
	if (record.hosted) throw new Error("Export a hosted channel after moving it here with ace move");
	const connection = await Connection.open(record.id);
	try {
		const seed = await connection.request<Seed>({ op: "export" });
		const path = resolve(file);
		writeFileSync(path, `${JSON.stringify(seed, null, "\t")}\n`, { mode: 0o600, flag: "wx" });
		return path;
	} finally {
		connection.close();
	}
}

/**
 * A seed as a new local channel in `dir`, or the current directory. `now` moves the seed's times
 * so its newest message is now. The channel is listed only once its store holds the whole seed.
 */
export async function importSeed(
	file: string,
	options: { dir: string; name?: string; now?: boolean },
): Promise<catalog.Listing> {
	const seed = JSON.parse(readFileSync(resolve(file), "utf8")) as Seed;
	validateSeed(seed);
	const record = {
		...catalog.draft(await project(options.dir), seed.chats[0]!.model, options.name || seed.name),
		...(seed.summary ? { summary: seed.summary } : {}),
	};
	const { base } = catalog.paths(record.id);
	try {
		await offline(
			{ ...record, named: true },
			(channel) => channel.import(seed, options.now ? shiftTo(seed, Date.now()) : 0),
		);
		return catalog.save({ ...record, named: true });
	} catch (error) {
		rmSync(base, { recursive: true, force: true });
		throw error;
	}
}
