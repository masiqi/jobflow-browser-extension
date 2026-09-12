import type { DeliveryRecord, OpportunityRecord } from "../types";

export const DELIVERY_COMPONENT_LABELS: Record<DeliveryRecord["applicationStatus"], string> = {
  pending: "待执行",
  attempted: "已尝试，待核验",
  verified: "已验证",
  failed: "未完成"
};

export const DELIVERY_OVERALL_LABELS: Record<DeliveryRecord["overallStatus"], string> = {
  ready: "待预检",
  preflighting: "预检中",
  awaiting_confirmation: "等待确认",
  in_progress: "执行中",
  partial: "部分完成",
  succeeded: "已完成",
  failed: "未完成",
  review_required: "需要复核"
};

const OPPORTUNITY_STATUS_LABELS: Record<OpportunityRecord["status"], string> = {
  discovered: "待处理",
  queued: "队列中",
  extracting: "读取详情",
  deterministic_excluded: "规则排除",
  evaluating: "模型判断",
  model_excluded: "模型淘汰",
  review_required: "待复核",
  generating: "生成草稿",
  draft_ready: "待发草稿",
  user_excluded: "用户排除",
  failed: "处理失败"
};

const DELIVERY_RECORD_LABELS: Record<DeliveryRecord["overallStatus"], string> = {
  ready: "待发草稿",
  preflighting: "发送预检中",
  awaiting_confirmation: "等待发送确认",
  in_progress: "真实发送执行中",
  partial: "投递部分完成",
  succeeded: "已投递并联系",
  failed: "发送未完成",
  review_required: "发送需要复核"
};

export function recordStatusLabel(record: OpportunityRecord, delivery?: DeliveryRecord): string {
  return delivery ? DELIVERY_RECORD_LABELS[delivery.overallStatus] : OPPORTUNITY_STATUS_LABELS[record.status];
}
