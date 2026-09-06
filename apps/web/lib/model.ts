import { anthropic } from "@ai-sdk/anthropic";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";

/** Anthropic API when a key is present; otherwise AWS Bedrock (region + IAM creds from env). */
export function model() {
  if (process.env.ANTHROPIC_API_KEY) return anthropic(process.env.ANTHROPIC_MODEL ?? "claude-opus-5");
  const bedrock = createAmazonBedrock({ region: process.env.AWS_REGION ?? "us-east-1" });
  return bedrock(process.env.BEDROCK_MODEL_ID ?? "global.anthropic.claude-haiku-4-5-20251001-v1:0");
}
