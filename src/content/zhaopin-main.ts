import type { ZhaopinPageJob } from "../platforms/zhaopin";

const BRIDGE_CHANNEL = "__JOBFLOW_ZHAOPIN_BRIDGE__";

function boundedValue(value: unknown, maxLength = 500): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function pageJobs(): ZhaopinPageJob[] {
  return [...document.querySelectorAll<HTMLElement>(".job-card")]
    .slice(0, 500)
    .map((card, index): ZhaopinPageJob => {
      const host = card as HTMLElement & {
        __vue__?: { _props?: { job?: unknown } };
      };
      const value = host.__vue__?._props?.job;
      const job = value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
      return {
        index,
        number: boundedValue(job.number, 128),
        name: boundedValue(job.name, 300),
        salary: boundedValue(job.salary60, 100),
        education: boundedValue(job.education, 100),
        experience: boundedValue(job.workingExp, 100),
        company: boundedValue(job.companyName, 300),
        location: [job.workCity, job.cityDistrict, job.streetName]
          .map((item) => boundedValue(item, 80))
          .filter(Boolean)
          .join(" ")
          .slice(0, 200),
        positionUrl: boundedValue(job.positionUrl || job.positionURL, 2048)
      };
    })
    .filter((job) => Boolean(job.number));
}

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data as { channel?: unknown; type?: unknown; requestId?: unknown } | null;
  if (!data
    || data.channel !== BRIDGE_CHANNEL
    || data.type !== "scan-request"
    || typeof data.requestId !== "string"
    || data.requestId.length > 128) {
    return;
  }
  window.postMessage({
    channel: BRIDGE_CHANNEL,
    type: "scan-response",
    requestId: data.requestId,
    jobs: pageJobs()
  }, "*");
});
