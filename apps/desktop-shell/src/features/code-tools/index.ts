import type {
  DesktopManagedAuthProvider,
} from "@/lib/tauri";

export const CLAUDE_CODE = "claude-code";
export const OPENAI_CODEX = "openai-codex";
export const CODEX_OPENAI_PROVIDER_ID = "codex-openai";
export const QWEN_CODE_PROVIDER_ID = "qwen-code";

const MANAGED_OAUTH_PROVIDER_IDS = [
  CODEX_OPENAI_PROVIDER_ID,
  QWEN_CODE_PROVIDER_ID,
] as const;

export const CODE_TOOL_IDS = [
  CLAUDE_CODE,
  OPENAI_CODEX,
] as const;

export type CodeToolId = (typeof CODE_TOOL_IDS)[number];

export const DEFAULT_CODE_TOOL: CodeToolId = CLAUDE_CODE;

export interface CodeToolOption {
  value: CodeToolId;
  label: string;
}

export interface CodeToolsProviderModel {
  providerId: string;
  providerName: string;
  providerType: string;
  baseUrl: string;
  protocol: string;
  providerLabel: string;
  modelId: string;
  displayName: string;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  billingKind: string | null;
  capabilityTags: string[];
  source: "managed_auth";
  hasStoredCredential: boolean;
}

export interface SelectedCodeToolModel extends CodeToolsProviderModel {}

export interface CodeToolsProviderEntry {
  id: string;
  name: string;
  providerType: string;
  protocol: string;
  baseUrl: string;
  hasStoredCredential: boolean;
  source: "managed_auth";
  defaultModelId: string | null;
  models: CodeToolsProviderModel[];
}

const CODE_TOOL_CONFIG: Record<
  CodeToolId,
  {
    label: string;
    requiresModel: boolean;
    providerIds: string[];
    launchMode: "managed_auth" | "local_cli";
  }
> = {
  [CLAUDE_CODE]: {
    label: "Claude Code",
    requiresModel: true,
    providerIds: [...MANAGED_OAUTH_PROVIDER_IDS],
    launchMode: "managed_auth",
  },
  [OPENAI_CODEX]: {
    label: "OpenAI Codex",
    requiresModel: true,
    providerIds: [CODEX_OPENAI_PROVIDER_ID],
    launchMode: "managed_auth",
  },
};

export const CLI_TOOLS: CodeToolOption[] = CODE_TOOL_IDS.map((toolId) => ({
  value: toolId,
  label: CODE_TOOL_CONFIG[toolId].label,
}));

export function toolRequiresModel(tool: CodeToolId): boolean {
  return CODE_TOOL_CONFIG[tool].requiresModel;
}

export function toolUsesManagedAuth(tool: CodeToolId): boolean {
  return CODE_TOOL_CONFIG[tool].launchMode === "managed_auth";
}

export function getCodeToolLabel(tool: CodeToolId): string {
  return CODE_TOOL_CONFIG[tool].label;
}

export function getCodeToolModelUniqId(model: SelectedCodeToolModel): string {
  return `${model.providerId}::${model.modelId}`;
}

export function filterProvidersForTool(
  providers: CodeToolsProviderEntry[],
  tool: CodeToolId
) {
  const providerIds = CODE_TOOL_CONFIG[tool].providerIds;
  if (providerIds.length === 0) {
    return [];
  }

  return providers.filter((provider) => providerIds.includes(provider.id));
}

export function parseEnvironmentVariables(envVars: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (!envVars.trim()) {
    return env;
  }

  for (const line of envVars.split("\n")) {
    const trimmedLine = line.trim();
    if (!trimmedLine || !trimmedLine.includes("=")) {
      continue;
    }
    const [key, ...valueParts] = trimmedLine.split("=");
    const trimmedKey = key.trim();
    if (!trimmedKey) {
      continue;
    }
    env[trimmedKey] = valueParts.join("=").trim();
  }

  return env;
}

function projectManagedAuthProvider(provider: DesktopManagedAuthProvider) {
  switch (provider.kind) {
    case "codex_openai":
      return {
        providerType: "codex_openai",
        protocol: "openai-responses",
        baseUrl: "https://api.openai.com/v1",
      };
    case "qwen_code":
      return {
        providerType: "qwen_code_oauth",
        protocol: "qwen-oauth",
        baseUrl: "https://chat.qwen.ai",
      };
    default:
      return null;
  }
}

export function buildCodeToolsProviderCatalog(
  managedAuthProviders: DesktopManagedAuthProvider[]
): CodeToolsProviderEntry[] {
  return managedAuthProviders
    .map((provider) => {
      const projection = projectManagedAuthProvider(provider);
      if (!projection) {
        return null;
      }

      return {
        id: provider.id,
        name: provider.name,
        providerType: projection.providerType,
        protocol: projection.protocol,
        baseUrl: projection.baseUrl,
        hasStoredCredential: provider.account_count > 0,
        source: "managed_auth" as const,
        defaultModelId: provider.default_model_id,
        models: provider.models.map((model) => ({
          providerId: provider.id,
          providerName: provider.name,
          providerType: projection.providerType,
          baseUrl: projection.baseUrl,
          protocol: projection.protocol,
          providerLabel: provider.name,
          modelId: model.model_id,
          displayName: model.display_name,
          contextWindow: model.context_window,
          maxOutputTokens: model.max_output_tokens,
          billingKind: model.billing_kind,
          capabilityTags: model.capability_tags,
          source: "managed_auth" as const,
          hasStoredCredential: provider.account_count > 0,
        })),
      };
    })
    .filter((provider): provider is CodeToolsProviderEntry => Boolean(provider))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function findPreferredCodeToolModel(
  providers: CodeToolsProviderEntry[],
  tool?: CodeToolId
): SelectedCodeToolModel | null {
  const configuredProviderIds =
    tool && tool in CODE_TOOL_CONFIG
      ? CODE_TOOL_CONFIG[tool].providerIds
      : [];

  const orderedProviders =
    configuredProviderIds.length > 0
      ? configuredProviderIds
          .map((providerId) =>
            providers.find((provider) => provider.id === providerId)
          )
          .filter((provider): provider is CodeToolsProviderEntry => Boolean(provider))
      : providers;
  const credentialedProviders = orderedProviders.filter(
    (provider) => provider.hasStoredCredential
  );
  const candidateProviders =
    credentialedProviders.length > 0 ? credentialedProviders : orderedProviders;
  const preferredProvider = candidateProviders[0] ?? null;

  if (preferredProvider?.defaultModelId) {
    const preferred = preferredProvider.models.find(
      (model) => model.modelId === preferredProvider.defaultModelId
    );
    if (preferred) {
      return preferred;
    }
  }

  return preferredProvider?.models[0] ?? providers[0]?.models[0] ?? null;
}
