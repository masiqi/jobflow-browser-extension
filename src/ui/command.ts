import type { RuntimeRequest } from "../domain/messages";

interface CommandEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
}
export async function sendCommand<T = void>(request: RuntimeRequest): Promise<T> {
  const response: CommandEnvelope<T> = await chrome.runtime.sendMessage(request);
  if (!response?.ok) throw new Error(response?.error || "扩展操作失败");
  return response.data as T;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const replacements: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return replacements[character] ?? character;
  });
}

export function formatTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      }).format(date);
}
