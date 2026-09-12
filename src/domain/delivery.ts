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
