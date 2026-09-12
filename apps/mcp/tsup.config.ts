import { defineConfig } from "tsup";
export default defineConfig({ entry: { server: "src/server.ts" }, format: ["esm"], dts: false, sourcemap: false, clean: true, target: "es2022", banner: { js: "#!/usr/bin/env node" }, noExternal: ["@yashjain99/mandate-sdk", "@yashjain99/mandate-ai"], external: [/^@ledgerhq\//, "rxjs", "@circle-fin/developer-controlled-wallets", "node-hid", "usb"] });
