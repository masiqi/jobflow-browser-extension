import type { ModelSettings } from "./types";

export async function chatCompletion(settings: ModelSettings, messages: Array<{ role: string; content: string }>): Promise<string> {
  if (!settings.apiKey.trim()) throw new Error("未配置 API Key");
  const endpoint = normalizeEndpoint(settings.endpoint);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), settings.timeoutSeconds * 1000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${settings.apiKey.trim()}`, ...settings.extraHeaders },
      body: JSON.stringify({ model: settings.model, messages, stream: false, temperature: settings.temperature, max_tokens: 800, response_format: { type: "json_object" } }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`模型服务 HTTP ${response.status}`);
    const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error("模型响应缺少内容");
    return content;
  } finally { clearTimeout(timer); }
}

function normalizeEndpoint(raw: string): string {
  const value = raw.trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(value)) return value;
  return /\/v\d+$/i.test(value) ? `${value}/chat/completions` : `${value}/v1/chat/completions`;
}
