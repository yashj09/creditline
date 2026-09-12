import { client, out } from "./_client.ts";
import { runRepaymentCheck } from "../src/cron.ts";
out(await runRepaymentCheck(client, Number(process.env.REMIND_DAYS ?? 2)));
