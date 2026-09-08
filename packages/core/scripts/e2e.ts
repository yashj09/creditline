/**
 * Deterministic end-to-end run of the demo intent WITHOUT the AI layer:
 *   Base Sepolia: wrap → supply WETH → borrow USDC (inside mandate)
 *   Base Sepolia: guardian-approved CCTP burn towards the same account on Arc
 *   Arc:          relay attestation (receiveMessage), then guardian-approved payment to RECIPIENT
 *   Arc:          schedule repayment intent
 *
 * Env (testnet keys only):
 *   AGENT_PRIVATE_KEY      agent EOA (or set CIRCLE_* to use a Circle developer-controlled wallet)
 *   GUARDIAN_PRIVATE_KEY   dev-only stand-in for the Ledger; the web app uses the device instead
 *   RECIPIENT              payee on Arc
 *   BORROW_USDC=100        amount in whole USDC (default 100), BRIDGE_USDC (default = BORROW), PAY_USDC (default = BRIDGE/2)
 * Requires contracts/deployments/{base-sepolia,arc-testnet}.json (script/Deploy.s.sol) and the policy applied.
 */
import { createPublicClient, http, parseUnits, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  ARC_TESTNET,
  BASE_SEPOLIA,
  AuditLog,
  CircleAgentWallet,
  LocalAgentWallet,
  MandateAccountAbi,
  approvalText,
  buildBurn,
  buildPay,
  buildSupplyAndBorrow,
  callsHash,
  chains,
  collateralFor,
  encodeExecute,
  encodeExecuteWithGuardian,
  encodeReceiveMessage,
  encodeScheduleRepayment,
  explorerTx,
  loadDeployment,
  planIdToBytes32,
  readCometPosition,
  usdcBalance,
  waitForAttestation,
  CCTP,
  type AgentWallet,
} from "../src/index.ts";

const env = (k: string, d?: string) => process.env[k] ?? d ?? (() => { throw new Error(`missing env ${k}`); })();

const base = loadDeployment("base-sepolia");
const arc = loadDeployment("arc-testnet");
if (!base || !arc) throw new Error("deploy first: forge script script/Deploy.s.sol --rpc-url <base_sepolia|arc_testnet> --broadcast");
if (base.account.toLowerCase() !== arc.account.toLowerCase()) throw new Error("account address differs across chains; check CREATE2 salt/args");
const account = base.account;

const audit = new AuditLog(new URL("../../../.data/audit.jsonl", import.meta.url).pathname);
const planId = `e2e-${Date.now()}`;
const planIdHex = planIdToBytes32(planId);
const chainMap = { [chains.baseSepolia.id]: chains.baseSepolia, [chains.arcTestnet.id]: chains.arcTestnet };

const useCircle = !!(process.env.CIRCLE_API_KEY && process.env.CIRCLE_ENTITY_SECRET && process.env.CIRCLE_WALLET_SET_ID);
const wallet: AgentWallet = useCircle
  ? new CircleAgentWallet({ apiKey: env("CIRCLE_API_KEY"), entitySecret: env("CIRCLE_ENTITY_SECRET"), walletSetId: env("CIRCLE_WALLET_SET_ID") })
  : new LocalAgentWallet(env("AGENT_PRIVATE_KEY") as Hex, chainMap);
const guardian = privateKeyToAccount(env("GUARDIAN_PRIVATE_KEY") as Hex);
const recipient = env("RECIPIENT") as Address;

const basePub = createPublicClient({ chain: chains.baseSepolia, transport: http() });
const arcPub = createPublicClient({ chain: chains.arcTestnet, transport: http() });

const borrow = parseUnits(env("BORROW_USDC", "100"), 6);
const bridge = parseUnits(env("BRIDGE_USDC", env("BORROW_USDC", "100")), 6);
const pay = parseUnits(env("PAY_USDC", (Number(env("BRIDGE_USDC", env("BORROW_USDC", "100"))) / 2).toString()), 6);

async function guardianSign(chainId: number, step: number, calls: ReturnType<typeof buildBurn>, maxOut: bigint) {
  const pub = chainId === chains.baseSepolia.id ? basePub : arcPub;
  const nonce = await pub.readContract({ address: account, abi: MandateAccountAbi, functionName: "guardianNonce" });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const text = approvalText({ account, chainId, planId: planIdHex, step, maxUsdcOut: maxOut, callsHash: callsHash(calls), deadline, nonce });
  // sanity: the contract must produce the identical string
  const onchain = await pub.readContract({ address: account, abi: MandateAccountAbi, functionName: "approvalText", args: [planIdHex, step, maxOut, callsHash(calls), deadline, nonce] });
  if (onchain !== text) throw new Error(`approvalText mismatch\nTS:\n${text}\nSOL:\n${onchain}`);
  audit.write({ planId, step, kind: "guardian-request", chainId, summary: "Guardian approval requested", data: { text } });
  console.log("\n─── guardian would see on device ───\n" + text + "\n────────────────────────────────────");
  const signature = await guardian.signMessage({ message: text });
  audit.write({ planId, step, kind: "guardian-approved", chainId, summary: `Signed by ${guardian.address}` });
  return { signature, deadline };
}

async function main() {
  console.log(`plan ${planId}\naccount ${account}\nagent ${await wallet.address(chains.baseSepolia.id)} (${wallet.kind})\nguardian ${guardian.address}`);
  audit.write({ planId, step: 0, kind: "plan", summary: `Borrow ${borrow} → bridge ${bridge} → pay ${pay} to ${recipient}` });

  // ---- Step 1: supply + borrow on Compound v3 (Base Sepolia), inside mandate ------------------------
  const pos0 = await readCometPosition(basePub, account);
  const weth = collateralFor(borrow, pos0.wethPriceUsd, pos0.liquidateCollateralFactor, 1.6);
  const bal = await basePub.getBalance({ address: account });
  if (bal < weth) throw new Error(`account needs ${weth} wei ETH on Base Sepolia for collateral, has ${bal}`);
  const s1 = buildSupplyAndBorrow(weth, borrow);
  const h1 = await wallet.send({ chainId: chains.baseSepolia.id, to: account, data: encodeExecute(s1, planIdHex, 1) });
  let pos1 = await readCometPosition(basePub, account);
  for (let i = 0; i < 5 && pos1.debtUsdc === 0n; i++) { await new Promise((r) => setTimeout(r, 3000)); pos1 = await readCometPosition(basePub, account); } // public RPC lag
  audit.write({ planId, step: 1, kind: "execute", chainId: 84532, txHash: h1, explorer: explorerTx(chains.baseSepolia, h1), summary: `Supplied ${weth} wei WETH, borrowed ${borrow} USDC on Compound v3`, data: { healthFactor: pos1.healthFactor, liquidationPriceUsd: pos1.liquidationPriceUsd, borrowAprPct: pos1.borrowAprPct } });
  console.log(`step 1 ✓ ${explorerTx(chains.baseSepolia, h1)}  HF=${pos1.healthFactor.toFixed(2)} liq@$${pos1.liquidationPriceUsd?.toFixed(0)}`);

  // ---- Step 2: CCTP burn towards Arc (irreversible → guardian) -------------------------------------
  const s2 = buildBurn({ usdc: BASE_SEPOLIA.usdc, amount: bridge, destinationDomain: ARC_TESTNET.domain, mintRecipient: account });
  const g2 = await guardianSign(chains.baseSepolia.id, 2, s2, bridge);
  const h2 = await wallet.send({ chainId: chains.baseSepolia.id, to: account, data: encodeExecuteWithGuardian(s2, bridge, planIdHex, 2, g2.deadline, g2.signature) });
  audit.write({ planId, step: 2, kind: "execute", chainId: 84532, txHash: h2, explorer: explorerTx(chains.baseSepolia, h2), summary: `Burned ${bridge} USDC into CCTP v2 → Arc (fast transfer)` });
  console.log(`step 2 ✓ ${explorerTx(chains.baseSepolia, h2)}  waiting for Circle attestation…`);

  // ---- Step 3: relay mint on Arc (permissionless; agent wallet calls transmitter directly) -----------
  const att = await waitForAttestation(BASE_SEPOLIA.domain, h2);
  const before = await usdcBalance(arcPub, ARC_TESTNET.usdc, account);
  const h3 = await wallet.send({ chainId: chains.arcTestnet.id, to: CCTP.messageTransmitterV2, data: encodeReceiveMessage(att) });
  const after = await usdcBalance(arcPub, ARC_TESTNET.usdc, account);
  audit.write({ planId, step: 3, kind: "execute", chainId: 5042002, txHash: h3, explorer: explorerTx(chains.arcTestnet, h3), summary: `Minted ${after - before} USDC on Arc` });
  console.log(`step 3 ✓ ${explorerTx(chains.arcTestnet, h3)}  +${after - before} USDC on Arc`);

  // ---- Step 4: pay recipient on Arc (irreversible → guardian) ---------------------------------------
  const s4 = buildPay({ to: recipient, amountUsdc6: pay, mode: "native" });
  const g4 = await guardianSign(chains.arcTestnet.id, 4, s4, pay);
  const h4 = await wallet.send({ chainId: chains.arcTestnet.id, to: account, data: encodeExecuteWithGuardian(s4, pay, planIdHex, 4, g4.deadline, g4.signature) });
  audit.write({ planId, step: 4, kind: "execute", chainId: 5042002, txHash: h4, explorer: explorerTx(chains.arcTestnet, h4), summary: `Paid ${pay} USDC to ${recipient} on Arc` });
  console.log(`step 4 ✓ ${explorerTx(chains.arcTestnet, h4)}`);

  // ---- Step 5: schedule repayment intent on the Arc account -----------------------------------------
  const dueAt = BigInt(Math.floor(Date.now() / 1000) + 7 * 86400);
  const h5 = await wallet.send({ chainId: chains.arcTestnet.id, to: account, data: encodeScheduleRepayment(dueAt, borrow, BASE_SEPOLIA.comet) });
  audit.write({ planId, step: 5, kind: "execute", chainId: 5042002, txHash: h5, explorer: explorerTx(chains.arcTestnet, h5), summary: `Repayment of ${borrow} USDC scheduled for ${new Date(Number(dueAt) * 1000).toISOString()}` });
  console.log(`step 5 ✓ ${explorerTx(chains.arcTestnet, h5)}\n\ndone. audit → .data/audit.jsonl`);
}

main().catch((e) => {
  audit.write({ planId, step: -1, kind: "error", summary: String(e?.message ?? e) });
  console.error(e);
  process.exit(1);
});
