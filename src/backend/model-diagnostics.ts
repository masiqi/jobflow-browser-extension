import { z } from "zod";

const valueKindSchema = z.enum(["array", "boolean", "null", "number", "object", "string", "undefined"]);
const fieldNameSchema = z.enum([
  "ok", "summary", "targetRoles", "skills", "facts", "constraints",
  "outcome", "score", "reasons", "jdEvidence", "factIds", "greeting"
]);

export const modelOutputDiagnosticSchema = z.object({
  requestId: z.string().uuid(),
  operation: z.enum(["test_provider", "extract_resume_profile", "evaluate_opportunity", "generate_greeting"]),
  provider: z.enum(["openai", "deepseek", "openrouter", "custom"]),
  model: z.string().max(200),
  stage: z.literal("model_output"),
  outputKind: valueKindSchema,
  fields: z.array(z.object({
    name: fieldNameSchema,
    kind: valueKindSchema
  }).strict()).max(12),
  missingFields: z.array(fieldNameSchema).max(12),
  unknownFieldCount: z.number().int().nonnegative().max(1000),
  issues: z.array(z.object({
    path: z.string().min(1).max(160).regex(/^[A-Za-z0-9_.<>\[\]-]+$/),
    code: z.string().min(1).max(40).regex(/^[a-z_]+$/)
  }).strict()).max(6)
}).strict();

export type ModelOutputDiagnostic = z.infer<typeof modelOutputDiagnosticSchema>;

const OPERATION_LABELS: Record<ModelOutputDiagnostic["operation"], string> = {
  test_provider: "连接测试",
  extract_resume_profile: "简历画像提取",
  evaluate_opportunity: "适配度评估",
  generate_greeting: "招呼语生成"
};

export function formatModelOutputDiagnostic(diagnostic: ModelOutputDiagnostic): string {
  const details = diagnostic.issues.slice(0, 3)
    .map((issue) => issue.path + ":" + issue.code);
  if (diagnostic.missingFields.length) {
    details.push("缺少 " + diagnostic.missingFields.slice(0, 3).join(","));
  }
  if (diagnostic.unknownFieldCount) details.push("未知字段 " + diagnostic.unknownFieldCount + " 个");
  return (
    "模型输出结构无效（" + OPERATION_LABELS[diagnostic.operation]
    + (details.length ? "；" + details.join("；") : "；输出类型 " + diagnostic.outputKind)
    + "；请求 " + diagnostic.requestId.slice(0, 8) + "）"
  ).slice(0, 200);
}

export function reportModelOutputDiagnostic(input: unknown): string {
  const parsed = modelOutputDiagnosticSchema.safeParse(input);
  if (!parsed.success) return "";
  console.warn("[JobFlow:model-output-validation]", parsed.data);
  return formatModelOutputDiagnostic(parsed.data);
}
