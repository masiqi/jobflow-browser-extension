import type {
  DeliveryComponentStatus,
  DeliveryOverallStatus,
  DeliveryRecord
} from "./types";

export interface DeliveryComponentPatch {
  applicationStatus?: DeliveryComponentStatus;
  greetingStatus?: DeliveryComponentStatus;
  reason?: string;
}

function nextComponentStatus(
  previous: DeliveryComponentStatus,
  requested?: DeliveryComponentStatus
): DeliveryComponentStatus {
  if (!requested || previous === "verified") return previous;
  return requested;
}

export function deriveDeliveryOverallStatus(
  applicationStatus: DeliveryComponentStatus,
  greetingStatus: DeliveryComponentStatus,
  forced?: DeliveryOverallStatus
): DeliveryOverallStatus {
  if (forced === "ready" || forced === "preflighting" || forced === "awaiting_confirmation" || forced === "review_required") {
    return forced;
  }
  if (applicationStatus === "verified" && greetingStatus === "verified") return "succeeded";
  if (applicationStatus === "verified" || greetingStatus === "verified") return "partial";
  if (applicationStatus === "failed" || greetingStatus === "failed") return "failed";
  if (applicationStatus === "attempted" || greetingStatus === "attempted") return "in_progress";
  return forced ?? "ready";
}

function deliveryComponentReason(
  label: "正式投递" | "招呼语",
  status: DeliveryComponentStatus
): string {
  if (status === "verified") return label + "已从猎聘页面验证";
  if (status === "attempted") return label + "已尝试，尚未取得独立平台证据";
  if (status === "failed") return label + "未完成";
  return label + "尚未执行";
}

export function deliveryPartialReason(record: DeliveryRecord): string {
  return [
    deliveryComponentReason("正式投递", record.applicationStatus),
    deliveryComponentReason("招呼语", record.greetingStatus)
  ].join("；");
}

export function applyDeliveryPatch(
  record: DeliveryRecord,
  patch: DeliveryComponentPatch,
  updatedAt: string,
  forcedOverall?: DeliveryOverallStatus
): DeliveryRecord {
  const applicationStatus = nextComponentStatus(record.applicationStatus, patch.applicationStatus);
  const greetingStatus = nextComponentStatus(record.greetingStatus, patch.greetingStatus);
  return {
    ...record,
    applicationStatus,
    greetingStatus,
    overallStatus: deriveDeliveryOverallStatus(applicationStatus, greetingStatus, forcedOverall),
    latestReason: patch.reason ?? record.latestReason,
    updatedAt
  };
}

export function deliveryNeedsApplication(record: DeliveryRecord): boolean {
  return record.applicationStatus !== "verified";
}

export function deliveryNeedsGreeting(record: DeliveryRecord): boolean {
  return record.greetingStatus !== "verified";
}
