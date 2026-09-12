import { defineConfig } from "tsup";
export default defineConfig({
  entry: { index: "src/index.ts", "ledger-web": "src/ledger-web.ts" },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  external: [/^@ledgerhq\//, "rxjs", "@circle-fin/developer-controlled-wallets", "viem", "node:fs", "node:path"],
});
