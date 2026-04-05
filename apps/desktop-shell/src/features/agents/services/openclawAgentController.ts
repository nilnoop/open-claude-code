/**
 * OpenClaw Agent Controller
 *
 * Ported from clawhub123/src/v2/features/agents/services/openclawAgentController.ts
 *
 * Responsible for:
 * 1. Fetching composite agent detail from 6 parallel IPC calls
 * 2. Normalizing/inferring installed/running state from multiple signals
 * 3. Resolving UI labels (status, primary action, notices, lifecycle steps)
 * 4. Assembling the AgentWorkbenchState view model
 */

import i18n from "@/i18n";
import {
  agentPipelineStart,
  agentPipelineStatus,
  openclawConnectStatus,
  openclawRuntimeSnapshot,
  openclawSetupOverview,
  openclawServiceControl,
  openDashboardUrl,
} from "@/lib/tauri";
import type {
  AgentPipelineStatus,
  OpenclawAgentDetail,
  OpenclawConnectStatus,
  OpenclawRuntimeSnapshot,
  SetupProductOverview,
  AgentWorkbenchSupported,
  AgentWorkbenchLoading,
  AgentWorkbenchError,
  AgentLifecycleStep,
  AgentRuntimeMetric,
  AgentKeyValueItem,
  AgentStatusNotice,
  HomeTone,
} from "@/types/agent";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OPENCLAW_DASHBOARD_URL =
  "http://127.0.0.1:18790/chat?session=agent%3Amain%3Amain";
const DETAIL_FETCH_TIMEOUT_MS = 8_000;
const DETAIL_FETCH_RETRY_COUNT = 1;
const DETAIL_FETCH_RETRY_DELAY_MS = 350;

const TRANSIENT_DETAIL_ERROR_PATTERNS = [
  "networkerror",
  "network error",
  "failed to fetch",
  "socket hang up",
  "connection reset",
  "connection refused",
  "channel closed",
  "transport",
  "ipc",
  "temporarily unavailable",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type DetailCallResult<T> = { value: T | null; error: string | null };

function describeError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function isTransientDetailError(error: unknown): boolean {
  const message = describeError(error).toLowerCase();
  if (message.includes("timed out") || message.includes("timeout")) {
    return false;
  }
  return TRANSIENT_DETAIL_ERROR_PATTERNS.some((p) => message.includes(p));
}

async function withTimeout<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs = DETAIL_FETCH_TIMEOUT_MS
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            new Error(
              `${label} timed out (> ${Math.floor(timeoutMs / 1000)}s)`
            )
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function settleDetailCall<T>(
  label: string,
  load: () => Promise<T>
): Promise<DetailCallResult<T>> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= DETAIL_FETCH_RETRY_COUNT; attempt++) {
    try {
      return { value: await withTimeout(load(), label), error: null };
    } catch (error) {
      lastError = error;
      if (
        attempt >= DETAIL_FETCH_RETRY_COUNT ||
        !isTransientDetailError(error)
      ) {
        break;
      }
      await delay(DETAIL_FETCH_RETRY_DELAY_MS * (attempt + 1));
    }
  }
  return { value: null, error: `${label}${i18n.t("agent.error.fetchSuffix")}${describeError(lastError)}` };
}

function hasMeaningfulStatus(status: AgentPipelineStatus): boolean {
  return (
    status.running ||
    status.finished ||
    (status.logs?.length ?? 0) > 0 ||
    Boolean(status.hint)
  );
}

// ---------------------------------------------------------------------------
// Fallback factories
// ---------------------------------------------------------------------------

function synthesizeStatus(
  action: "install" | "start",
  success: boolean,
  hint: string,
  dashboardUrl?: string
): AgentPipelineStatus {
  return {
    run_key: `openclaw:${action}`,
    agent_id: "openclaw",
    action,
    running: false,
    finished: true,
    success,
    logs: [],
    dashboard_url: dashboardUrl ?? null,
    hint,
    updated_at_epoch: Math.floor(Date.now() / 1000),
  };
}

function pendingStatus(action: "install" | "start"): AgentPipelineStatus {
  return {
    run_key: `openclaw:${action}`,
    agent_id: "openclaw",
    action,
    running: false,
    finished: false,
    success: false,
    logs: [],
    dashboard_url: null,
    hint: null,
    updated_at_epoch: Math.floor(Date.now() / 1000),
  };
}

function fallbackConnectStatus(
  error: string | null
): OpenclawConnectStatus {
  return {
    connected: false,
    installed: false,
    command_path: null,
    version: null,
    install_mode: null,
    managed_by_warwolf: false,
    node_version: null,
    provider_exists: false,
    model_count: 0,
    error,
  };
}

function fallbackRuntimeSnapshot(): OpenclawRuntimeSnapshot {
  return {
    running: false,
    pid: null,
    memory_bytes: null,
    uptime_seconds: null,
    activity_state: "unknown",
    os: "Unknown",
    config_initialized: false,
  };
}

function fallbackUninstallStatus(): AgentPipelineStatus {
  return {
    run_key: "openclaw:uninstall",
    agent_id: "openclaw",
    action: "uninstall",
    running: false,
    finished: false,
    success: false,
    logs: [],
    dashboard_url: null,
    hint: null,
    updated_at_epoch: Math.floor(Date.now() / 1000),
  };
}

function fallbackProductOverview(
  connectStatus: OpenclawConnectStatus,
  runtimeSnapshot: OpenclawRuntimeSnapshot
): SetupProductOverview {
  return {
    installed: connectStatus.installed,
    connected: connectStatus.connected,
    service_running: runtimeSnapshot.running,
    model_count: connectStatus.model_count,
    install_mode:
      (connectStatus.install_mode as "managed_native" | "reuse_existing") ??
      null,
    version: connectStatus.version ?? null,
    command_path: connectStatus.command_path ?? null,
    managed_by_warwolf: connectStatus.managed_by_warwolf,
    node_version: connectStatus.node_version ?? null,
  };
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function hasCommandHealthFailure(detail: OpenclawAgentDetail): boolean {
  const errorMessage = detail.connectStatus.error?.toLowerCase();
  const hasHealthCheckFailure =
    errorMessage?.includes("command health check failed") ?? false;
  return (
    Boolean(detail.connectStatus.command_path) &&
    !detail.connectStatus.installed &&
    hasHealthCheckFailure
  );
}

function normalizeOpenclawDetail(
  detail: OpenclawAgentDetail
): OpenclawAgentDetail {
  const next = { ...detail };

  // Infer service running from multiple signals
  const inferredServiceRunning =
    next.product.service_running ||
    next.runtimeSnapshot.running ||
    (next.serviceStatus.finished &&
      next.serviceStatus.success &&
      Boolean(next.serviceStatus.dashboard_url));

  if (inferredServiceRunning && !next.product.service_running) {
    next.product = { ...next.product, service_running: true };
  }

  if (inferredServiceRunning) {
    next.serviceStatus = {
      ...next.serviceStatus,
      running: false,
      finished: true,
      success: true,
      dashboard_url:
        next.serviceStatus.dashboard_url ?? OPENCLAW_DASHBOARD_URL,
      hint:
        next.serviceStatus.success && next.serviceStatus.hint
          ? next.serviceStatus.hint
          : i18n.t("agent.message.serviceDetectedRunning"),
    };
  }

  // Infer installed from multiple signals
  const inferredInstalled =
    next.product.installed ||
    next.connectStatus.installed ||
    (next.installStatus.finished &&
      next.installStatus.success &&
      Boolean(next.connectStatus.command_path));

  if (inferredInstalled && !next.product.installed) {
    next.product = {
      ...next.product,
      installed: true,
      install_mode:
        next.product.install_mode ??
        (next.connectStatus.install_mode as
          | "managed_native"
          | "reuse_existing") ??
        null,
      version: next.product.version ?? next.connectStatus.version ?? null,
      command_path:
        next.product.command_path ?? next.connectStatus.command_path ?? null,
      managed_by_warwolf:
        next.product.managed_by_warwolf ||
        next.connectStatus.managed_by_warwolf,
      node_version:
        next.product.node_version ?? next.connectStatus.node_version ?? null,
    };
  }

  // Handle command health failure
  if (
    hasCommandHealthFailure(next) &&
    !next.installStatus.running &&
    !next.uninstallStatus.running &&
    (!inferredServiceRunning ||
      (next.uninstallStatus.finished &&
        next.uninstallStatus.success &&
        !next.connectStatus.installed))
  ) {
    next.product = { ...next.product, installed: false, service_running: false };
  }

  // Synthesize pending/success statuses where needed
  if (!next.product.installed && !hasMeaningfulStatus(next.installStatus)) {
    next.installStatus = pendingStatus("install");
  } else if (
    next.product.installed &&
    !hasMeaningfulStatus(next.installStatus)
  ) {
    next.installStatus = synthesizeStatus(
      "install",
      true,
      i18n.t("agent.message.installDetected")
    );
  }

  if (
    !next.product.service_running &&
    !hasMeaningfulStatus(next.serviceStatus)
  ) {
    next.serviceStatus = pendingStatus("start");
  } else if (
    next.product.service_running &&
    !hasMeaningfulStatus(next.serviceStatus)
  ) {
    next.serviceStatus = synthesizeStatus(
      "start",
      true,
      i18n.t("agent.message.serviceDetectedRunning"),
      OPENCLAW_DASHBOARD_URL
    );
  }

  return next;
}

// ---------------------------------------------------------------------------
// Status label resolution
// ---------------------------------------------------------------------------

function resolveStatusLabel(detail: OpenclawAgentDetail): {
  label: string;
  tone: HomeTone;
} {
  if (detail.uninstallStatus.running) return { label: i18n.t("agent.status.uninstalling"), tone: "info" };
  if (detail.installStatus.running) return { label: i18n.t("agent.status.installing"), tone: "info" };
  if (
    !detail.product.installed &&
    detail.installStatus.finished &&
    !detail.installStatus.success
  )
    return { label: i18n.t("agent.status.installFailed"), tone: "error" };
  if (detail.serviceStatus.running) return { label: i18n.t("agent.status.starting"), tone: "info" };
  if (
    detail.product.installed &&
    !detail.product.service_running &&
    detail.serviceStatus.finished &&
    !detail.serviceStatus.success
  )
    return { label: i18n.t("agent.status.startFailed"), tone: "error" };
  if (detail.product.service_running)
    return { label: i18n.t("agent.status.installedRunning"), tone: "success" };
  if (detail.product.installed)
    return { label: i18n.t("agent.status.installedStopped"), tone: "warning" };
  return { label: i18n.t("agent.status.notInstalled"), tone: "default" };
}

function resolvePrimaryActionLabel(detail: OpenclawAgentDetail): string {
  if (detail.installStatus.running) return i18n.t("agent.button.installing");
  if (!detail.product.installed) {
    if (detail.installStatus.finished && !detail.installStatus.success) {
      return i18n.t("agent.button.retryInstall");
    }
    return i18n.t("agent.button.install");
  }
  if (detail.serviceStatus.running) return i18n.t("agent.button.starting");
  if (!detail.product.service_running) {
    if (detail.serviceStatus.finished && !detail.serviceStatus.success) {
      return i18n.t("agent.button.retryStart");
    }
    return i18n.t("agent.button.startService");
  }
  return i18n.t("agent.button.openDashboard");
}

function resolveStatusNotice(detail: OpenclawAgentDetail): AgentStatusNotice {
  if (detail.uninstallStatus.running) {
    return {
      tone: "info",
      message: detail.uninstallStatus.hint ?? i18n.t("agent.message.uninstalling"),
    };
  }
  if (detail.uninstallStatus.finished && !detail.uninstallStatus.success) {
    return {
      tone: "error",
      message:
        detail.uninstallStatus.hint ?? i18n.t("agent.error.uninstallFailedCheckLog"),
    };
  }
  if (detail.installStatus.running) {
    return {
      tone: "info",
      message: detail.installStatus.hint ?? i18n.t("agent.message.installing"),
    };
  }
  if (!detail.product.installed) {
    if (detail.installStatus.finished && !detail.installStatus.success) {
      return {
        tone: "error",
        message:
          detail.installStatus.hint ?? i18n.t("agent.error.installFailedCheckLog"),
      };
    }
    if (detail.uninstallStatus.finished && detail.uninstallStatus.success) {
      return {
        tone: "info",
        message: detail.uninstallStatus.hint ?? i18n.t("agent.message.uninstallComplete"),
      };
    }
    return { tone: "default", message: i18n.t("agent.message.pleaseInstall") };
  }
  if (detail.serviceStatus.running) {
    return {
      tone: "info",
      message: detail.serviceStatus.hint ?? i18n.t("agent.message.startingService"),
    };
  }
  if (!detail.product.service_running) {
    if (detail.serviceStatus.finished && !detail.serviceStatus.success) {
      return {
        tone: "error",
        message:
          detail.serviceStatus.hint ?? i18n.t("agent.error.startFailedCheckLog"),
      };
    }
    return { tone: "success", message: i18n.t("agent.message.installSuccessStartService") };
  }
  return { tone: "success", message: i18n.t("agent.message.serviceReadyOpenDashboard") };
}

// ---------------------------------------------------------------------------
// Lifecycle step resolution
// ---------------------------------------------------------------------------

function resolveLifecycleStatus(
  action: "install" | "start",
  detail: OpenclawAgentDetail
): { label: string; tone: HomeTone } {
  const status =
    action === "install" ? detail.installStatus : detail.serviceStatus;
  if (status.running) {
    return {
      label: action === "install" ? i18n.t("agent.status.installing") : i18n.t("agent.status.starting"),
      tone: "info",
    };
  }
  if (status.finished && status.success) {
    return {
      label: action === "install" ? i18n.t("agent.status.installComplete") : i18n.t("agent.status.serviceReady"),
      tone: "success",
    };
  }
  if (status.finished && !status.success) {
    return {
      label: action === "install" ? i18n.t("agent.status.installFailed") : i18n.t("agent.status.startFailed"),
      tone: "error",
    };
  }
  if (action === "install") {
    return detail.product.installed
      ? { label: i18n.t("agent.status.installComplete"), tone: "success" }
      : { label: i18n.t("agent.status.notStarted"), tone: "default" };
  }
  return detail.product.service_running
    ? { label: i18n.t("agent.status.serviceReady"), tone: "success" }
    : { label: i18n.t("agent.status.notStartedService"), tone: "warning" };
}

function resolveLifecycleSteps(
  detail: OpenclawAgentDetail
): AgentLifecycleStep[] {
  const installStatus = resolveLifecycleStatus("install", detail);
  const startStatus = resolveLifecycleStatus("start", detail);
  const shouldShowStartStep =
    detail.product.installed ||
    detail.serviceStatus.running ||
    detail.serviceStatus.finished ||
    (detail.serviceStatus.logs?.length ?? 0) > 0 ||
    Boolean(detail.serviceStatus.hint);

  const installStep: AgentLifecycleStep = {
    id: "install",
    title: i18n.t("agent.section.step1Install"),
    description: i18n.t("agent.description.installDescription"),
    statusLabel: installStatus.label,
    statusTone: installStatus.tone,
    rows: [
      { label: i18n.t("agent.field.installMode"), value: detail.product.install_mode ?? "--" },
      { label: i18n.t("agent.field.version"), value: detail.product.version ?? "--" },
      { label: i18n.t("agent.field.nodeVersion"), value: detail.product.node_version ?? "--" },
      { label: i18n.t("agent.field.commandPath"), value: detail.product.command_path ?? "--" },
    ],
    hint: detail.installStatus.hint,
    logs: detail.installStatus.logs ?? [],
    emptyText: i18n.t("agent.empty.noInstallLogs"),
    defaultExpanded:
      detail.installStatus.running ||
      (detail.installStatus.finished && !detail.installStatus.success) ||
      (detail.installStatus.logs?.length ?? 0) > 0,
  };

  const steps: AgentLifecycleStep[] = [installStep];

  if (shouldShowStartStep) {
    steps.push({
      id: "start",
      title: i18n.t("agent.section.step2Start"),
      description: i18n.t("agent.description.startDescription"),
      statusLabel: startStatus.label,
      statusTone: startStatus.tone,
      rows: [
        {
          label: i18n.t("agent.field.runningStatus"),
          value: detail.product.service_running ? "Running" : "Stopped",
        },
        {
          label: i18n.t("agent.field.dashboardPage"),
          value:
            detail.serviceStatus.dashboard_url ??
            i18n.t("agent.field.dashboardDynamic"),
        },
        {
          label: i18n.t("agent.field.serviceHint"),
          value: detail.serviceStatus.hint ?? i18n.t("agent.field.waitingForStartOrDetect"),
        },
      ],
      hint: detail.product.service_running
        ? i18n.t("agent.message.serviceReadyOpenDashboardShort")
        : detail.serviceStatus.hint,
      logs: detail.serviceStatus.logs ?? [],
      emptyText: i18n.t("agent.empty.noStartLogs"),
      defaultExpanded:
        detail.serviceStatus.running ||
        (detail.serviceStatus.finished && !detail.serviceStatus.success) ||
        (detail.serviceStatus.logs?.length ?? 0) > 0,
    });
  }

  return steps;
}

// ---------------------------------------------------------------------------
// Metrics / environment
// ---------------------------------------------------------------------------

function formatMemory(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return "--";
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function formatUptime(seconds?: number | null): string {
  if (!seconds || seconds < 0) return "--";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function resolveRuntimeActivityLabel(detail: OpenclawAgentDetail): string {
  if (detail.serviceStatus.running) return i18n.t("agent.activity.starting");
  if (!detail.runtimeSnapshot.running) return i18n.t("agent.activity.notStarted");
  if (detail.runtimeSnapshot.activity_state === "busy") return i18n.t("agent.activity.processing");
  if (detail.runtimeSnapshot.activity_state === "idle") return i18n.t("agent.activity.idle");
  return i18n.t("agent.activity.running");
}

function resolveRuntimeMetrics(
  detail: OpenclawAgentDetail
): AgentRuntimeMetric[] {
  return [
    { label: i18n.t("agent.field.runningStatus"), value: resolveRuntimeActivityLabel(detail) },
    {
      label: i18n.t("agent.field.memoryUsage"),
      value: formatMemory(detail.runtimeSnapshot.memory_bytes),
    },
    {
      label: i18n.t("agent.field.uptime"),
      value: formatUptime(detail.runtimeSnapshot.uptime_seconds),
    },
  ];
}

function resolveEnvironmentItems(
  detail: OpenclawAgentDetail
): AgentKeyValueItem[] {
  return [
    { label: i18n.t("agent.field.openclawVersion"), value: detail.connectStatus.version ?? "--" },
    { label: "Node.js", value: detail.connectStatus.node_version ?? "--" },
    { label: i18n.t("agent.field.commandPath"), value: detail.connectStatus.command_path ?? "--" },
  ];
}

// ---------------------------------------------------------------------------
// Public: Fetch detail
// ---------------------------------------------------------------------------

export async function fetchOpenclawDetail(): Promise<OpenclawAgentDetail> {
  const [cs, overview, runtime, install, service, uninstall] =
    await Promise.all([
      settleDetailCall(i18n.t("agent.loading.readConnectStatus"), () => openclawConnectStatus()),
      settleDetailCall(i18n.t("agent.loading.readSetupOverview"), () =>
        openclawSetupOverview()
      ),
      settleDetailCall(i18n.t("agent.loading.readRuntimeSnapshot"), () =>
        openclawRuntimeSnapshot()
      ),
      settleDetailCall(i18n.t("agent.loading.readInstallPipeline"), () =>
        agentPipelineStatus("openclaw", "install")
      ),
      settleDetailCall(i18n.t("agent.loading.readStartPipeline"), () =>
        agentPipelineStatus("openclaw", "start")
      ),
      settleDetailCall(i18n.t("agent.loading.readUninstallPipeline"), () =>
        agentPipelineStatus("openclaw", "uninstall")
      ),
    ]);

  const fetchErrors = [
    cs.error,
    overview.error,
    runtime.error,
    install.error,
    service.error,
    uninstall.error,
  ].filter((v): v is string => Boolean(v));

  const resolvedCS = cs.value ?? fallbackConnectStatus(cs.error);
  const resolvedRuntime = runtime.value ?? fallbackRuntimeSnapshot();

  const product = overview.value ??
    fallbackProductOverview(resolvedCS, resolvedRuntime);

  return normalizeOpenclawDetail({
    connectStatus: resolvedCS,
    product,
    runtimeSnapshot: resolvedRuntime,
    installStatus: install.value ?? pendingStatus("install"),
    serviceStatus: service.value ?? pendingStatus("start"),
    uninstallStatus: uninstall.value ?? fallbackUninstallStatus(),
    fetchErrors,
  });
}

// ---------------------------------------------------------------------------
// Public: Build workbench state
// ---------------------------------------------------------------------------

export function buildWorkbench(
  detail: OpenclawAgentDetail
): AgentWorkbenchSupported {
  const status = resolveStatusLabel(detail);
  return {
    kind: "supported",
    detail,
    statusLabel: status.label,
    statusTone: status.tone,
    statusNotice: resolveStatusNotice(detail),
    primaryActionLabel: resolvePrimaryActionLabel(detail),
    heroSummary: [
      i18n.t("agent.state.modelCount", { count: detail.product.model_count }),
      detail.product.connected ? i18n.t("agent.state.connectedWarwolf") : i18n.t("agent.state.pendingWarwolf"),
    ],
    runtimeMetrics: resolveRuntimeMetrics(detail),
    environmentItems: resolveEnvironmentItems(detail),
    lifecycleSteps: resolveLifecycleSteps(detail),
    uninstallActionLabel: i18n.t("agent.button.uninstall"),
  };
}

export function buildLoadingWorkbench(): AgentWorkbenchLoading {
  return {
    kind: "loading",
    statusLabel: i18n.t("agent.status.loading"),
    statusTone: "info",
    statusNotice: { tone: "info", message: i18n.t("agent.loading.loadingState") },
    primaryActionLabel: i18n.t("agent.button.loading"),
  };
}

export function buildErrorWorkbench(
  message: string
): AgentWorkbenchError {
  return {
    kind: "error",
    statusLabel: i18n.t("agent.status.fetchFailed"),
    statusTone: "error",
    statusNotice: {
      tone: "error",
      message: i18n.t("agent.error.stateFetchFailed", { message }),
    },
    primaryActionLabel: i18n.t("agent.button.reload"),
    errorMessage: message,
  };
}

// ---------------------------------------------------------------------------
// Public: Resolve primary action kind
// ---------------------------------------------------------------------------

export function resolvePrimaryActionKind(
  detail: OpenclawAgentDetail
): "install" | "start" | "dashboard" {
  if (
    hasCommandHealthFailure(detail) &&
    !detail.installStatus.running &&
    !detail.uninstallStatus.running &&
    !detail.product.service_running
  ) {
    return "install";
  }
  if (
    detail.uninstallStatus.finished &&
    detail.uninstallStatus.success &&
    !detail.connectStatus.installed
  ) {
    return "install";
  }
  if (!detail.product.installed) return "install";
  if (!detail.product.service_running) return "start";
  return "dashboard";
}

// ---------------------------------------------------------------------------
// Public: Get refetch interval
// ---------------------------------------------------------------------------

export function getDetailRefetchInterval(
  detail?: OpenclawAgentDetail
): number | false {
  if (!detail) return false;
  if (
    detail.installStatus.running ||
    detail.serviceStatus.running ||
    detail.uninstallStatus.running
  ) {
    return 1500;
  }
  return detail.product.service_running ? 5000 : false;
}

// ---------------------------------------------------------------------------
// Public: Dashboard URL
// ---------------------------------------------------------------------------

export function dashboardUrl(detail?: OpenclawAgentDetail): string {
  return detail?.serviceStatus.dashboard_url ?? OPENCLAW_DASHBOARD_URL;
}

// ---------------------------------------------------------------------------
// Public: Actions
// ---------------------------------------------------------------------------

export const openclawActions = {
  install: () => agentPipelineStart("openclaw", "install"),
  start: () => agentPipelineStart("openclaw", "start"),
  stop: () => openclawServiceControl("stop"),
  uninstall: () => agentPipelineStart("openclaw", "uninstall"),
  openDashboard: (detail?: OpenclawAgentDetail) =>
    openDashboardUrl(dashboardUrl(detail)),
};
