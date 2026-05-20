import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export type LLMMessage = ChatCompletionMessageParam;

export interface LLMProvider {
  complete(messages: LLMMessage[]): Promise<string>;
}

export interface OpenAICompatibleProviderOptions {
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

export function createOpenAICompatibleProvider(
  options: OpenAICompatibleProviderOptions = {},
): LLMProvider {
  const apiKey = options.apiKey ?? process.env.LLM_API_KEY;
  const baseURL = options.baseURL ?? process.env.LLM_BASE_URL;
  const model = options.model ?? process.env.LLM_MODEL;

  const missing = [
    ["LLM_BASE_URL", baseURL],
    ["LLM_API_KEY", apiKey],
    ["LLM_MODEL", model],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(
      `Missing LLM configuration: ${missing.join(
        ", ",
      )}. Set LLM_BASE_URL, LLM_API_KEY, and LLM_MODEL in your environment or .env file.`,
    );
  }

  const resolvedApiKey = apiKey as string;
  const resolvedBaseURL = baseURL as string;
  const resolvedModel = model as string;

  const client = new OpenAI({
    apiKey: resolvedApiKey,
    baseURL: resolvedBaseURL,
  });

  return {
    async complete(messages: LLMMessage[]): Promise<string> {
      const response = await client.chat.completions.create({
        model: resolvedModel,
        messages,
      });

      return response.choices[0]?.message?.content?.trim() ?? "";
    },
  };
}
