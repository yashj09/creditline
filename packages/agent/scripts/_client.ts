import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
loadEnv({ path: resolve(process.cwd(), "../../.env"), quiet: true });
import { createMandateFromEnv, fileStore } from "@yashjain99/mandate-sdk";
import { mandateTools } from "../src/tools.ts";
export const client = createMandateFromEnv({ store: fileStore(process.env.MANDATE_STORE_DIR ?? resolve(process.cwd(), "../../.data")) });
export const tools = mandateTools(client) as Record<string, any>;
export const out = (v: unknown) => console.log(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2));
