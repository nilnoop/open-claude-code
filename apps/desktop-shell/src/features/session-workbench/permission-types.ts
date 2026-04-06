export type PermissionAction = "allow" | "deny" | "allow_always";

export interface PermissionRequest {
  id: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  riskLevel: "low" | "medium" | "high";
  description?: string;
}
