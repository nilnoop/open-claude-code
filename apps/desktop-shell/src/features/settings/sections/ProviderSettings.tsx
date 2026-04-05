import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import i18n from "@/i18n";
import {
  CheckCircle2,
  Cloud,
  Download,
  ExternalLink,
  Loader2,
  LogIn,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  activateCodexAuthProfile,
  beginCodexLogin,
  getCodexAuthOverview,
  getCodexRuntime,
  getManagedProviders,
  getProviderPresets,
  importCodexAuthProfile,
  openDashboardUrl,
  pollCodexLogin,
  refreshCodexAuthProfile,
  removeCodexAuthProfile,
  syncManagedProvider,
  upsertManagedProvider,
  type DesktopCodexAuthOverview,
  type DesktopCodexAuthSource,
  type DesktopCodexLoginSessionSnapshot,
  type DesktopCodexProfileSummary,
  type DesktopCustomizeState,
  type DesktopManagedProvider,
  type DesktopProviderModel,
  type DesktopProviderPreset,
} from "@/lib/tauri";

const OPENAI_PROVIDER_PRESET_ID = "codex-openai";

interface ProviderSettingsProps {
  customize: DesktopCustomizeState | null;
  error?: string;
}

interface Notice {
  tone: "info" | "success" | "error";
  message: string;
}

type BusyAction =
  | "initializing"
  | "toggle-enabled"
  | "sync"
  | "refresh"
  | "import-auth"
  | "login"
  | "activate-profile"
  | "refresh-profile"
  | "remove-profile"
  | "set-default-model"
  | null;

export function ProviderSettings({ customize, error }: ProviderSettingsProps) {
  const { t } = useTranslation();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [removeProfileId, setRemoveProfileId] = useState<string | null>(null);
  const [initializingProvider, setInitializingProvider] = useState(false);
  const [codexLoginSession, setCodexLoginSession] =
    useState<DesktopCodexLoginSessionSnapshot | null>(null);
  const codexLoginStatusRef = useRef<string | null>(null);

  const presetsQuery = useQuery({
    queryKey: ["provider-presets"],
    queryFn: async () => (await getProviderPresets()).presets,
    refetchOnWindowFocus: false,
  });

  const providersQuery = useQuery({
    queryKey: ["managed-providers"],
    queryFn: async () => (await getManagedProviders()).providers,
    refetchOnWindowFocus: false,
  });

  const codexRuntimeQuery = useQuery({
    queryKey: ["codex-runtime"],
    queryFn: async () => (await getCodexRuntime()).runtime,
    refetchOnWindowFocus: false,
  });

  const codexAuthOverviewQuery = useQuery({
    queryKey: ["codex-auth-overview"],
    queryFn: async () => (await getCodexAuthOverview()).overview,
    refetchOnWindowFocus: false,
  });

  const openAiPreset = useMemo(
    () =>
      (presetsQuery.data ?? []).find((preset) => preset.id === OPENAI_PROVIDER_PRESET_ID) ?? null,
    [presetsQuery.data]
  );

  const managedOpenAiProvider = useMemo(
    () =>
      (providersQuery.data ?? []).find((provider) => isOpenAiProvider(provider)) ?? null,
    [providersQuery.data]
  );

  const codexRuntime = codexRuntimeQuery.data ?? null;
  const codexAuthOverview = codexAuthOverviewQuery.data ?? null;
  const displayProvider = managedOpenAiProvider ?? openAiPreset;
  const displayProviderEnabled = managedOpenAiProvider?.enabled ?? true;

  const activeProfile = useMemo(
    () => resolveCurrentCodexProfile(codexAuthOverview),
    [codexAuthOverview]
  );

  const openAiLiveProvider = useMemo(
    () =>
      managedOpenAiProvider
        ? codexRuntime?.live_providers.find((provider) => provider.id === managedOpenAiProvider.id) ??
          null
        : null,
    [codexRuntime, managedOpenAiProvider]
  );

  const syncState = useMemo(() => {
    if (!managedOpenAiProvider) {
      return {
        label: t("provider.status.notWritten"),
        applied: false,
        live: false,
      };
    }
    const live = Boolean(openAiLiveProvider);
    const applied = codexRuntime?.active_provider_key === managedOpenAiProvider.id;
    if (applied) {
      return { label: t("provider.status.syncedActive"), applied: true, live: true };
    }
    if (live) {
      return { label: t("provider.status.writtenToCodex"), applied: false, live: true };
    }
    return { label: t("provider.status.notWritten"), applied: false, live: false };
  }, [codexRuntime, managedOpenAiProvider, openAiLiveProvider, t]);

  const displayModels = useMemo(
    () => managedOpenAiProvider?.models ?? openAiPreset?.models ?? [],
    [managedOpenAiProvider, openAiPreset]
  );

  const groupedModels = useMemo(() => groupOpenAiModels(displayModels), [displayModels]);

  const currentDefaultModelId =
    syncState.applied && codexRuntime?.model
      ? codexRuntime.model
      : displayModels[0]?.model_id ?? null;

  const diagnostics = useMemo(() => {
    const messages: Array<{ tone: "success" | "warning"; message: string }> = [];
    if (!activeProfile && !codexAuthOverview?.has_chatgpt_tokens) {
      messages.push({
        tone: "warning",
        message: t("provider.diagnostics.noAccount"),
      });
    }
    if (managedOpenAiProvider && !managedOpenAiProvider.enabled) {
      messages.push({
        tone: "warning",
        message: t("provider.diagnostics.disabled"),
      });
    }
    if (managedOpenAiProvider && !syncState.live) {
      messages.push({
        tone: "warning",
        message: t("provider.diagnostics.notWritten"),
      });
    }
    if (managedOpenAiProvider && syncState.live && !syncState.applied) {
      messages.push({
        tone: "warning",
        message: t("provider.diagnostics.otherProvider"),
      });
    }
    if (
      activeProfile &&
      managedOpenAiProvider?.enabled &&
      syncState.applied &&
      currentDefaultModelId
    ) {
      messages.push({
        tone: "success",
        message: t("provider.diagnostics.configured", { label: activeProfile.display_label, model: currentDefaultModelId }),
      });
    }
    return messages;
  }, [
    activeProfile,
    codexAuthOverview?.has_chatgpt_tokens,
    currentDefaultModelId,
    managedOpenAiProvider,
    syncState.applied,
    syncState.live,
    t,
  ]);

  const warningBanner = useMemo(() => {
    if (!activeProfile && !codexAuthOverview?.has_chatgpt_tokens) {
      return t("provider.diagnostics.noAccount");
    }
    if (managedOpenAiProvider && !syncState.live) {
      return t("provider.diagnostics.connectedButNotWritten");
    }
    if (managedOpenAiProvider && syncState.live && !syncState.applied) {
      return t("provider.diagnostics.writtenButNotActive");
    }
    return null;
  }, [activeProfile, codexAuthOverview?.has_chatgpt_tokens, managedOpenAiProvider, syncState, t]);

  async function refreshPageData() {
    await Promise.all([
      presetsQuery.refetch(),
      providersQuery.refetch(),
      codexRuntimeQuery.refetch(),
      codexAuthOverviewQuery.refetch(),
    ]);
  }

  const ensureOpenAiProvider = useCallback(async (): Promise<DesktopManagedProvider> => {
    if (managedOpenAiProvider) {
      return managedOpenAiProvider;
    }
    if (!openAiPreset) {
      throw new Error(t("provider.error.presetNotLoaded"));
    }
    const response = await upsertManagedProvider(toManagedProviderPayload(openAiPreset));
    return response.provider;
  }, [managedOpenAiProvider, openAiPreset]);

  useEffect(() => {
    if (
      initializingProvider ||
      providersQuery.isLoading ||
      providersQuery.isRefetching ||
      providersQuery.error ||
      !openAiPreset ||
      managedOpenAiProvider
    ) {
      return;
    }
    let cancelled = false;
    setInitializingProvider(true);
    void ensureOpenAiProvider()
      .then(async () => {
        await refreshPageData();
      })
      .catch((providerError) => {
        if (!cancelled) {
          const message =
            providerError instanceof Error
              ? providerError.message
              : t("provider.error.initFailed");
          setNotice({ tone: "error", message });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setInitializingProvider(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    ensureOpenAiProvider,
    initializingProvider,
    managedOpenAiProvider,
    openAiPreset,
    providersQuery.error,
    providersQuery.isLoading,
    providersQuery.isRefetching,
  ]);

  useEffect(() => {
    if (!codexLoginSession || codexLoginSession.status !== "pending") {
      return;
    }
    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await pollCodexLogin(codexLoginSession.session_id);
        setCodexLoginSession(response.session);
      } catch (pollError) {
        const message =
          pollError instanceof Error ? pollError.message : t("provider.error.pollLoginFailed");
        setNotice({ tone: "error", message });
      }
    }, 1500);
    return () => window.clearTimeout(timeoutId);
  }, [codexLoginSession]);

  useEffect(() => {
    if (!codexLoginSession) return;
    if (codexLoginStatusRef.current === codexLoginSession.status) {
      return;
    }
    codexLoginStatusRef.current = codexLoginSession.status;
    if (codexLoginSession.status === "completed") {
      void refreshPageData();
      setNotice({
        tone: "success",
        message: codexLoginSession.profile
          ? t("provider.success.loginWithProfile", { label: codexLoginSession.profile.display_label })
          : t("provider.success.loginCompleted"),
      });
    }
    if (codexLoginSession.status === "failed" && codexLoginSession.error) {
      setNotice({ tone: "error", message: codexLoginSession.error });
    }
  }, [codexLoginSession]);

  async function handleRefresh() {
    setBusyAction("refresh");
    try {
      await refreshPageData();
      setNotice({ tone: "success", message: t("provider.success.refreshed") });
    } catch (refreshError) {
      const message =
        refreshError instanceof Error ? refreshError.message : t("provider.error.refreshFailed");
      setNotice({ tone: "error", message });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleToggleEnabled() {
    setBusyAction("toggle-enabled");
    try {
      const provider = await ensureOpenAiProvider();
      await upsertManagedProvider(
        toManagedProviderPayload(provider, { enabled: !provider.enabled })
      );
      await refreshPageData();
      setNotice({
        tone: "success",
        message: provider.enabled ? t("provider.success.disabled") : t("provider.success.enabled"),
      });
    } catch (toggleError) {
      const message =
        toggleError instanceof Error ? toggleError.message : t("provider.error.toggleFailed");
      setNotice({ tone: "error", message });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSync() {
    setBusyAction("sync");
    try {
      const provider = await ensureOpenAiProvider();
      if (!provider.enabled) {
        throw new Error(t("provider.error.enableBeforeSync"));
      }
      const response = await syncManagedProvider(provider.id, { set_primary: false });
      await refreshPageData();
      setNotice({
        tone: "success",
        message: t("provider.success.synced", { path: response.result.config_path }),
      });
    } catch (syncError) {
      const message =
        syncError instanceof Error ? syncError.message : t("provider.error.syncFailed");
      setNotice({ tone: "error", message });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleImportCurrentAuth() {
    setBusyAction("import-auth");
    try {
      await importCodexAuthProfile();
      await refreshPageData();
      setNotice({
        tone: "success",
        message: t("provider.success.importedAuth"),
      });
    } catch (authError) {
      const message =
        authError instanceof Error ? authError.message : t("provider.error.importAuthFailed");
      setNotice({ tone: "error", message });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleBeginLogin() {
    setBusyAction("login");
    try {
      const response = await beginCodexLogin();
      setCodexLoginSession(response.session);
      await openDashboardUrl(response.session.authorize_url);
      setNotice({
        tone: "info",
        message: t("provider.success.loginPageOpened"),
      });
    } catch (loginError) {
      const message =
        loginError instanceof Error ? loginError.message : t("provider.error.loginFailed");
      setNotice({ tone: "error", message });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleActivateProfile(profileId: string) {
    setBusyAction("activate-profile");
    try {
      await activateCodexAuthProfile(profileId);
      await refreshPageData();
      setNotice({
        tone: "success",
        message: t("provider.success.profileActivated"),
      });
    } catch (activateError) {
      const message =
        activateError instanceof Error ? activateError.message : t("provider.error.activateProfileFailed");
      setNotice({ tone: "error", message });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRefreshProfile(profileId: string) {
    setBusyAction("refresh-profile");
    try {
      await refreshCodexAuthProfile(profileId);
      await refreshPageData();
      setNotice({ tone: "success", message: t("provider.success.profileRefreshed") });
    } catch (refreshError) {
      const message =
        refreshError instanceof Error ? refreshError.message : t("provider.error.refreshProfileFailed");
      setNotice({ tone: "error", message });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRemoveProfile(profileId: string) {
    setRemoveProfileId(profileId);
  }

  async function executeRemoveProfile(profileId: string) {
    setRemoveProfileId(null);
    setBusyAction("remove-profile");
    try {
      await removeCodexAuthProfile(profileId);
      await refreshPageData();
      setNotice({ tone: "success", message: t("provider.success.profileRemoved") });
    } catch (removeError) {
      const message =
        removeError instanceof Error ? removeError.message : t("provider.error.removeProfileFailed");
      setNotice({ tone: "error", message });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSetDefaultModel(modelId: string) {
    setBusyAction("set-default-model");
    try {
      const provider = await ensureOpenAiProvider();
      const reorderedModels = prioritizeModel(provider.models, modelId);
      await upsertManagedProvider(
        toManagedProviderPayload(provider, {
          models: reorderedModels,
        })
      );
      await refreshPageData();
      setNotice({
        tone: "success",
        message: t("provider.success.defaultModelSet", { modelId }),
      });
    } catch (modelError) {
      const message =
        modelError instanceof Error ? modelError.message : t("provider.error.setDefaultModelFailed");
      setNotice({ tone: "error", message });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleOpenWebsite() {
    const website = displayProvider?.website_url ?? openAiPreset?.website_url ?? null;
    if (!website) return;
    try {
      await openDashboardUrl(website);
    } catch (openError) {
      const message =
        openError instanceof Error ? openError.message : t("provider.error.openWebsiteFailed");
      setNotice({ tone: "error", message });
    }
  }

  const pageError =
    errorMessage(providersQuery.error) ??
    errorMessage(presetsQuery.error) ??
    errorMessage(codexRuntimeQuery.error) ??
    errorMessage(codexAuthOverviewQuery.error) ??
    error;

  return (
    <div className="space-y-4">
      {(notice || pageError) && (
        <StatusBanner
          tone={notice?.tone ?? "error"}
          message={notice?.message ?? pageError ?? ""}
        />
      )}

      <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
        <section className="overflow-hidden rounded-2xl border border-border bg-background">
          <div className="border-b border-border px-5 py-4">
            <div className="text-base font-semibold text-foreground">{t("provider.section.providerService")}</div>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {t("provider.description.onlyOpenAi")}
            </p>
          </div>

          <ScrollArea className="h-[min(72vh,860px)]">
            <div className="space-y-4 p-4">
              <button
                type="button"
                className={cn(
                  "w-full rounded-2xl border px-4 py-4 text-left transition",
                  "border-primary bg-primary/5"
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-foreground text-sm font-semibold text-background">
                    AI
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-base font-semibold text-foreground">OpenAI</div>
                      <Badge variant="outline">{t("provider.badge.official")}</Badge>
                      <Badge variant={displayProviderEnabled ? "default" : "secondary"}>
                        {displayProviderEnabled ? t("provider.badge.enabled") : t("provider.badge.disabled")}
                      </Badge>
                    </div>
                    <div className="mt-2 text-sm text-muted-foreground">
                      {activeProfile ? t("provider.status.connected", { label: activeProfile.display_label }) : t("provider.status.notLoggedIn")}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <Badge variant="outline">{syncState.label}</Badge>
                      {currentDefaultModelId ? (
                        <Badge variant="outline">{currentDefaultModelId}</Badge>
                      ) : null}
                    </div>
                  </div>
                </div>
              </button>

              <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">
                {t("provider.note.unsupported")}
              </div>
            </div>
          </ScrollArea>
        </section>

        <section className="rounded-2xl border border-border bg-background p-5">
          {displayProvider ? (
            <div className="space-y-5">
              <div className="flex flex-col gap-4 border-b border-border pb-5 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-2xl font-semibold text-foreground">OpenAI</h3>
                    <Badge variant="outline">{t("provider.badge.official")}</Badge>
                    <Badge variant="outline">{t("provider.badge.codexLogin")}</Badge>
                    {displayProviderEnabled ? (
                      <Badge variant="default">{t("provider.badge.enabled")}</Badge>
                    ) : (
                      <Badge variant="secondary">{t("provider.badge.disabled")}</Badge>
                    )}
                  </div>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                    {t("provider.description.openAiResponses")}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" onClick={() => void handleOpenWebsite()}>
                    <ExternalLink className="size-4" />
                    {t("provider.button.website")}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void handleRefresh()}
                    disabled={busyAction !== null}
                  >
                    {busyAction === "refresh" ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <RefreshCw className="size-4" />
                    )}
                    {t("provider.button.refreshStatus")}
                  </Button>
                  <Button
                    onClick={() => void handleSync()}
                    disabled={busyAction !== null || !displayProviderEnabled}
                  >
                    {busyAction === "sync" ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Cloud className="size-4" />
                    )}
                    {t("provider.button.syncToCodex")}
                  </Button>
                  <button
                    type="button"
                    className={cn(
                      "inline-flex h-9 items-center rounded-full border px-4 text-sm font-medium transition-colors",
                      displayProviderEnabled
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground"
                    )}
                    onClick={() => void handleToggleEnabled()}
                    disabled={busyAction !== null}
                  >
                    {busyAction === "toggle-enabled" ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : displayProviderEnabled ? (
                      t("provider.badge.enabled")
                    ) : (
                      t("provider.badge.disabled")
                    )}
                  </button>
                </div>
              </div>

              {warningBanner ? <NoticeBar message={warningBanner} /> : null}

              <SectionCard
                title={t("provider.section.accountConnection")}
                description={t("provider.description.codexLoginOnly")}
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <MetricCard
                    label={t("provider.field.currentStatus")}
                    value={activeProfile ? t("provider.loginStatus.loggedIn") : t("provider.loginStatus.notLoggedIn")}
                    hint={
                      activeProfile
                        ? t("provider.field.currentAccount", { label: activeProfile.display_label })
                        : t("provider.field.pleaseLogin")
                    }
                    tone={activeProfile ? "success" : "warning"}
                  />
                  <MetricCard
                    label={t("provider.field.syncStatus")}
                    value={syncState.label}
                    hint={
                      syncState.applied
                        ? t("provider.field.syncActiveHint")
                        : t("provider.field.syncPendingHint")
                    }
                    tone={syncState.applied ? "success" : "warning"}
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void handleBeginLogin()} disabled={busyAction !== null}>
                    {busyAction === "login" ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <LogIn className="size-4" />
                    )}
                    {t("provider.button.loginWithChatGPT")}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void handleImportCurrentAuth()}
                    disabled={busyAction !== null}
                  >
                    {busyAction === "import-auth" ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Download className="size-4" />
                    )}
                    {t("provider.button.importCodexAuth")}
                  </Button>
                  {codexLoginSession?.status === "pending" ? (
                    <Button
                      variant="outline"
                      onClick={() => void openDashboardUrl(codexLoginSession.authorize_url)}
                      disabled={busyAction !== null}
                    >
                      <ExternalLink className="size-4" />
                      {t("provider.button.reopenAuthPage")}
                    </Button>
                  ) : null}
                </div>

                {codexLoginSession ? (
                  <div className="rounded-2xl border border-border bg-muted/10 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-medium text-foreground">{t("provider.field.lastLoginFlow")}</div>
                      <Badge variant="outline">{formatLoginSessionStatus(codexLoginSession.status)}</Badge>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      {t("provider.field.redirectUri")}{codexLoginSession.redirect_uri}
                    </div>
                    {codexLoginSession.profile ? (
                      <div className="mt-2 text-sm text-foreground">
                        {t("provider.field.importedAccount")}{codexLoginSession.profile.display_label}
                      </div>
                    ) : null}
                    {codexLoginSession.error ? (
                      <div className="mt-2 text-sm text-destructive">
                        {codexLoginSession.error}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {codexAuthOverview ? (
                  <div className="space-y-3">
                    {codexAuthOverview.profiles.map((profile) => (
                      <ProfileCard
                        key={profile.id}
                        profile={profile}
                        busyAction={busyAction}
                        onActivate={() => void handleActivateProfile(profile.id)}
                        onRefresh={() => void handleRefreshProfile(profile.id)}
                        onRemove={() => void handleRemoveProfile(profile.id)}
                      />
                    ))}
                  </div>
                ) : (
                  <LoadingBlock label={t("provider.loading.readingAuthStatus")} />
                )}
              </SectionCard>

              <SectionCard
                title={t("provider.section.serviceConfig")}
                description={t("provider.description.readOnlyConfig")}
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <InfoField label={t("provider.field.authMethod")} value={t("provider.value.codexLogin")} />
                  <InfoField label={t("provider.field.protocol")} value="OpenAI Responses" />
                  <InfoField label={t("provider.field.apiUrl")} value={displayProvider.base_url} />
                  <InfoField label={t("provider.field.officialSite")} value={displayProvider.website_url ?? "https://platform.openai.com"} />
                  <InfoField label={t("provider.field.codexConfigFile")} value={codexRuntime?.config_path ?? "~/.codex/config.toml"} />
                  <InfoField label={t("provider.field.authFile")} value={codexRuntime?.auth_path ?? "~/.codex/auth.json"} />
                </div>
              </SectionCard>

              <SectionCard
                title={t("provider.section.models")}
                description={t("provider.description.modelCatalog")}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm text-muted-foreground">
                    {t("provider.field.defaultModel")}{currentDefaultModelId ?? t("provider.value.notSet")}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleRefresh()}
                    disabled={busyAction !== null}
                  >
                    <RefreshCw className="size-4" />
                    {t("provider.button.refreshModelStatus")}
                  </Button>
                </div>

                <div className="space-y-4">
                  {groupedModels.map((group) => (
                    <div key={group.label} className="overflow-hidden rounded-2xl border border-border">
                      <div className="border-b border-border bg-muted/20 px-4 py-3">
                        <div className="text-sm font-semibold text-foreground">{group.label}</div>
                      </div>
                      <div className="divide-y divide-border">
                        {group.models.map((model) => {
                          const isDefault = currentDefaultModelId === model.model_id;
                          return (
                            <div
                              key={model.model_id}
                              className="flex flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between"
                            >
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <div className="text-sm font-medium text-foreground">
                                    {model.display_name}
                                  </div>
                                  {isDefault ? <Badge variant="default">{t("provider.badge.defaultModel")}</Badge> : null}
                                </div>
                                <div className="mt-2 text-xs text-muted-foreground">
                                  {model.model_id}
                                </div>
                                <div className="mt-3 flex flex-wrap gap-1.5">
                                  {formatCapabilityTags(model.capability_tags).map((tag) => (
                                    <Badge key={tag} variant="outline">
                                      {tag}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <Button
                                  size="sm"
                                  variant={isDefault ? "secondary" : "outline"}
                                  disabled={busyAction !== null || isDefault}
                                  onClick={() => void handleSetDefaultModel(model.model_id)}
                                >
                                  {busyAction === "set-default-model" ? (
                                    <Loader2 className="size-4 animate-spin" />
                                  ) : isDefault ? (
                                    <CheckCircle2 className="size-4" />
                                  ) : null}
                                  {isDefault ? t("provider.button.currentDefault") : t("provider.button.setAsDefault")}
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </SectionCard>

              <SectionCard
                title={t("provider.section.diagnostics")}
                description={t("provider.description.diagnostics")}
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <InfoField label={t("provider.field.currentAccount2")} value={activeProfile?.display_label ?? t("provider.loginStatus.notLoggedIn")} />
                  <InfoField
                    label={t("provider.field.accountPlan")}
                    value={activeProfile?.chatgpt_plan_type ?? codexRuntime?.auth_plan_type ?? t("provider.value.unknown")}
                  />
                  <InfoField label={t("provider.field.currentProvider")} value={codexRuntime?.active_provider_key ?? t("provider.value.notSet")} />
                  <InfoField label={t("provider.field.currentModel")} value={codexRuntime?.model ?? customize?.model_label ?? t("provider.value.notSet")} />
                </div>
                <div className="space-y-2">
                  {diagnostics.length > 0 ? (
                    diagnostics.map((item) => (
                      <DiagnosticRow
                        key={`${item.tone}-${item.message}`}
                        tone={item.tone}
                        message={item.message}
                      />
                    ))
                  ) : (
                    <DiagnosticRow
                      tone="warning"
                      message={t("provider.diagnostics.waiting")}
                    />
                  )}
                </div>
              </SectionCard>
            </div>
          ) : (
            <EmptyState
              title={t("provider.loading.preparingService")}
              body={t("provider.loading.autoInitialize")}
            />
          )}
        </section>
      </div>

      <ConfirmDialog
        open={!!removeProfileId}
        onOpenChange={(open) => { if (!open) setRemoveProfileId(null); }}
        title="Remove account"
        description="Remove this OpenAI login account? You can re-add it later by logging in again."
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={() => {
          if (removeProfileId) void executeRemoveProfile(removeProfileId);
        }}
      />
    </div>
  );
}

function StatusBanner({
  tone,
  message,
}: {
  tone: "info" | "success" | "error";
  message: string;
}) {
  const toneClassName =
    tone === "success"
      ? "border-emerald-500/30 bg-emerald-500/10 text-foreground"
      : tone === "info"
        ? "border-border bg-muted/20 text-foreground"
        : "border-destructive/30 bg-destructive/10 text-foreground";
  return (
    <div className={cn("rounded-2xl border px-4 py-3 text-sm", toneClassName)}>{message}</div>
  );
}

function NoticeBar({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-foreground">
      {message}
    </div>
  );
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-muted/10 p-4">
      <div className="mb-4">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <div className="mt-1 text-xs leading-5 text-muted-foreground">{description}</div>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function MetricCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone: "success" | "warning";
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border px-4 py-4",
        tone === "success"
          ? "border-emerald-500/30 bg-emerald-500/10"
          : "border-amber-500/30 bg-amber-500/10"
      )}
    >
      <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="mt-2 text-lg font-semibold text-foreground">{value}</div>
      <div className="mt-2 text-xs leading-5 text-muted-foreground">{hint}</div>
    </div>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-background px-4 py-3">
      <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="mt-2 break-all text-sm text-foreground">{value}</div>
    </div>
  );
}

function ProfileCard({
  profile,
  busyAction,
  onActivate,
  onRefresh,
  onRemove,
}: {
  profile: DesktopCodexProfileSummary;
  busyAction: BusyAction;
  onActivate: () => void;
  onRefresh: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const isCurrent = profile.active && profile.applied_to_codex;
  return (
    <div
      className={cn(
        "rounded-2xl border bg-background px-4 py-4",
        isCurrent
          ? "border-emerald-500/35 bg-emerald-500/10"
          : profile.active
            ? "border-primary/35 bg-primary/5"
            : profile.applied_to_codex
              ? "border-sky-500/35 bg-sky-500/10"
              : "border-border"
      )}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <UserRound className="size-4" />
              {profile.display_label}
            </div>
            <Badge variant="outline">{formatCodexAuthSource(profile.auth_source)}</Badge>
            {profile.chatgpt_plan_type ? (
              <Badge variant="outline">{profile.chatgpt_plan_type}</Badge>
            ) : null}
            {profile.active ? <Badge variant="default">{t("provider.badge.currentAccount")}</Badge> : null}
            {profile.applied_to_codex ? (
              <Badge variant={isCurrent ? "default" : "outline"}>{t("provider.badge.codexActive")}</Badge>
            ) : null}
          </div>
          <div className="mt-2 text-xs text-muted-foreground">{profile.email}</div>
          <div className="mt-2 text-xs text-muted-foreground">
            {t("provider.field.lastUpdated")}{formatEpoch(profile.updated_at_epoch)}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={isCurrent ? "secondary" : "outline"}
            disabled={busyAction !== null || isCurrent}
            onClick={onActivate}
          >
            {busyAction === "activate-profile" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
            {isCurrent ? t("provider.button.currentlyUsed") : t("provider.button.setAsCurrent")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busyAction !== null}
            onClick={onRefresh}
          >
            {busyAction === "refresh-profile" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            {t("provider.button.refreshToken")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busyAction !== null}
            onClick={onRemove}
          >
            {busyAction === "remove-profile" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
            {t("provider.button.remove")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function DiagnosticRow({
  tone,
  message,
}: {
  tone: "success" | "warning";
  message: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm text-foreground",
        tone === "success"
          ? "border-emerald-500/30 bg-emerald-500/10"
          : "border-amber-500/30 bg-amber-500/10"
      )}
    >
      {tone === "success" ? (
        <ShieldCheck className="mt-0.5 size-4 shrink-0" />
      ) : (
        <ShieldAlert className="mt-0.5 size-4 shrink-0" />
      )}
      <div>{message}</div>
    </div>
  );
}

function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-border bg-muted/10 px-4 py-3 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      <span>{label}</span>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-dashed border-border bg-muted/10 px-8">
      <div className="max-w-md text-center">
        <div className="text-lg font-semibold text-foreground">{title}</div>
        <div className="mt-2 text-sm leading-6 text-muted-foreground">{body}</div>
      </div>
    </div>
  );
}

function resolveCurrentCodexProfile(overview: DesktopCodexAuthOverview | null) {
  if (!overview) return null;
  return (
    overview.profiles.find((profile) => profile.active && profile.applied_to_codex) ??
    overview.profiles.find((profile) => profile.active) ??
    overview.profiles.find((profile) => profile.applied_to_codex) ??
    null
  );
}

function isOpenAiProvider(provider: DesktopManagedProvider) {
  return (
    provider.id === OPENAI_PROVIDER_PRESET_ID ||
    provider.preset_id === OPENAI_PROVIDER_PRESET_ID ||
    provider.provider_type === "codex_openai"
  );
}

function toManagedProviderPayload(
  source: DesktopProviderPreset | DesktopManagedProvider,
  overrides?: Partial<{
    enabled: boolean;
    models: DesktopProviderModel[];
  }>
) {
  const isManagedProvider = isManagedProviderSource(source);
  return {
    id: isManagedProvider ? source.id : OPENAI_PROVIDER_PRESET_ID,
    name: source.name,
    runtime_target: source.runtime_target,
    category: source.category,
    provider_type: source.provider_type,
    billing_category: source.billing_category,
    protocol: source.protocol,
    base_url: source.base_url,
    enabled: overrides?.enabled ?? (isManagedProvider ? source.enabled : true),
    official_verified: source.official_verified,
    preset_id: isManagedProvider
      ? source.preset_id ?? (source.id === OPENAI_PROVIDER_PRESET_ID ? source.id : null)
      : source.id === OPENAI_PROVIDER_PRESET_ID
        ? source.id
        : null,
    website_url: source.website_url ?? null,
    description: source.description ?? null,
    models: overrides?.models ?? source.models,
  };
}

function isManagedProviderSource(
  source: DesktopProviderPreset | DesktopManagedProvider
): source is DesktopManagedProvider {
  return "api_key_masked" in source;
}

function prioritizeModel(models: DesktopProviderModel[], modelId: string) {
  const selected = models.find((model) => model.model_id === modelId);
  if (!selected) {
    throw new Error(i18n.t("provider.error.modelNotFound", { modelId }));
  }
  return [selected, ...models.filter((model) => model.model_id !== modelId)];
}

function groupOpenAiModels(models: DesktopProviderModel[]) {
  const groups = new Map<string, DesktopProviderModel[]>();
  for (const model of models) {
    const label = modelGroupLabel(model);
    const current = groups.get(label) ?? [];
    current.push(model);
    groups.set(label, current);
  }
  const orderedKeys = ["GPT 5", "GPT 5.1", "GPT_IMAGE", "OTHER"];
  const labelMap: Record<string, string> = {
    "GPT 5": "GPT 5",
    "GPT 5.1": "GPT 5.1",
    "GPT_IMAGE": i18n.t("provider.modelGroup.gptImage"),
    "OTHER": i18n.t("provider.modelGroup.other"),
  };
  return orderedKeys
    .filter((key) => groups.has(key))
    .map((key) => ({
      label: labelMap[key] ?? key,
      models: groups.get(key) ?? [],
    }));
}

function modelGroupLabel(model: DesktopProviderModel) {
  const haystack = `${model.model_id} ${model.display_name}`.toLowerCase();
  if (haystack.includes("image")) return "GPT_IMAGE";
  if (haystack.includes("gpt-5.1") || haystack.includes("gpt 5.1")) return "GPT 5.1";
  if (haystack.includes("gpt-5") || haystack.includes("gpt 5")) return "GPT 5";
  return "OTHER";
}

function formatCapabilityTags(tags: string[]) {
  if (tags.length === 0) return [i18n.t("provider.modelTag.general")];
  return tags.map((tag) => {
    switch (tag) {
      case "general":
        return i18n.t("provider.modelTag.chat");
      case "reasoning":
        return i18n.t("provider.modelTag.reasoning");
      case "coding":
        return i18n.t("provider.modelTag.coding");
      case "image":
        return i18n.t("provider.modelTag.image");
      default:
        return tag;
    }
  });
}

function formatCodexAuthSource(source: DesktopCodexAuthSource) {
  return source === "browser_login" ? i18n.t("provider.source.browserLogin") : i18n.t("provider.source.importAuthJson");
}

function formatLoginSessionStatus(status: DesktopCodexLoginSessionSnapshot["status"]) {
  switch (status) {
    case "pending":
      return i18n.t("provider.loginStatus.pending");
    case "completed":
      return i18n.t("provider.loginStatus.completed");
    case "failed":
      return i18n.t("provider.loginStatus.failed");
    case "cancelled":
      return i18n.t("provider.loginStatus.cancelled");
    default:
      return status;
  }
}

function formatEpoch(epoch: number | null) {
  if (!epoch) return i18n.t("provider.value.unknown");
  return new Date(epoch * 1000).toLocaleString();
}

function errorMessage(value: unknown) {
  return value instanceof Error ? value.message : undefined;
}
