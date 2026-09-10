import type { ModelProvider } from "./types";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.azure.internal"
]);

export function normalizeChatCompletionsEndpoint(rawEndpoint: string): string {
  const url = new URL(rawEndpoint.trim());
  if (url.protocol !== "https:") throw new Error("模型地址必须使用 HTTPS");
  if (url.username || url.password) throw new Error("模型地址不能包含用户名或密码");
  validatePublicEndpointHost(url.hostname);
  const path = url.pathname.replace(/\/+$/, "");
  if (path.endsWith("/chat/completions")) {
    url.pathname = path;
  } else if (path.endsWith("/v1")) {
    url.pathname = path + "/chat/completions";
  } else {
    url.pathname = path + "/v1/chat/completions";
  }
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function validatePublicEndpointHost(hostname: string): void {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  if (!normalized || BLOCKED_HOSTS.has(normalized) || normalized.endsWith(".local")) {
    throw new Error("模型地址必须是公开域名");
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized) || normalized.includes(":")) {
    throw new Error("模型地址不能使用 IP 字面量");
  }
}

export function providerLabel(provider: ModelProvider): string {
  switch (provider) {
    case "openai": return "OpenAI";
    case "deepseek": return "DeepSeek";
    case "openrouter": return "OpenRouter";
    case "custom": return "自定义兼容服务";
  }
}
