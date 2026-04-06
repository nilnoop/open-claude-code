use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use crate::codex_auth::{has_chatgpt_tokens, parse_chatgpt_jwt_claims, read_auth_payload};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use toml_edit::{DocumentMut, Item};

const DEFAULT_CODEX_CONFIG_FILE: &str = "config.toml";
const DEFAULT_CODEX_AUTH_FILE: &str = "auth.json";
const CODEX_MODEL_DISCOVERY_CACHE_TTL: Duration = Duration::from_secs(30);
const CODEX_MODEL_DISCOVERY_TIMEOUT: Duration = Duration::from_secs(5);
const CODEX_APP_SERVER_INITIALIZE_ID: u64 = 1;
const CODEX_APP_SERVER_MODEL_LIST_ID: u64 = 2;

static CODEX_OPENAI_MODELS_CACHE: OnceLock<Mutex<Option<CachedCodexModels>>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DesktopProviderModel {
    pub model_id: String,
    pub display_name: String,
    pub context_window: Option<i64>,
    pub max_output_tokens: Option<i64>,
    pub billing_kind: Option<String>,
    pub capability_tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DesktopCodexLiveProvider {
    pub id: String,
    pub name: Option<String>,
    pub base_url: Option<String>,
    pub wire_api: Option<String>,
    pub requires_openai_auth: bool,
    pub model: Option<String>,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DesktopCodexRuntimeState {
    pub config_dir: String,
    pub auth_path: String,
    pub config_path: String,
    pub active_provider_key: Option<String>,
    pub model: Option<String>,
    pub base_url: Option<String>,
    pub provider_count: usize,
    pub has_api_key: bool,
    pub has_chatgpt_tokens: bool,
    pub auth_mode: Option<String>,
    pub auth_profile_label: Option<String>,
    pub auth_plan_type: Option<String>,
    pub live_providers: Vec<DesktopCodexLiveProvider>,
    pub health_warnings: Vec<String>,
}

#[derive(Debug, Clone)]
struct CachedCodexModels {
    fetched_at: Instant,
    models: Vec<DesktopProviderModel>,
}

#[derive(Debug, Clone)]
struct CodexConfigSnapshot {
    active_provider_key: Option<String>,
    model: Option<String>,
    providers: Vec<CodexLiveProviderEntry>,
}

#[derive(Debug, Clone)]
struct CodexLiveProviderEntry {
    key: String,
    name: Option<String>,
    base_url: Option<String>,
    wire_api: Option<String>,
    requires_openai_auth: bool,
    model: Option<String>,
    is_active: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexAppServerInitializeResult {
    #[serde(default)]
    _user_agent: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexAppServerModelListResult {
    data: Vec<CodexAppServerModelEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexAppServerModelEntry {
    id: String,
    model: Option<String>,
    display_name: Option<String>,
    description: Option<String>,
    #[serde(default)]
    hidden: bool,
    #[serde(default)]
    supported_reasoning_efforts: Vec<CodexAppServerReasoningEffort>,
    #[serde(default)]
    input_modalities: Vec<String>,
    #[serde(default)]
    is_default: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexAppServerReasoningEffort {
    #[serde(rename = "reasoningEffort")]
    _reasoning_effort: String,
}

pub fn codex_runtime_state() -> Result<DesktopCodexRuntimeState, String> {
    let config_dir = resolve_codex_config_dir();
    let auth_path = config_dir.join(DEFAULT_CODEX_AUTH_FILE);
    let config_path = config_dir.join(DEFAULT_CODEX_CONFIG_FILE);
    let auth = read_auth_payload(None)?;
    let has_api_key = auth
        .get("OPENAI_API_KEY")
        .and_then(Value::as_str)
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    let has_chatgpt_tokens = has_chatgpt_tokens(&auth);
    let auth_mode = auth
        .get("auth_mode")
        .and_then(Value::as_str)
        .map(str::to_string);
    let auth_claims = auth
        .pointer("/tokens/id_token")
        .and_then(Value::as_str)
        .and_then(|jwt| parse_chatgpt_jwt_claims(jwt).ok());

    let mut active_provider_key = None;
    let mut model = None;
    let mut base_url = None;
    let mut live_providers = Vec::new();
    let mut warnings = Vec::new();

    if !config_path.exists() {
        warnings.push("Codex config.toml does not exist yet.".to_string());
    } else {
        let snapshot = load_codex_config_snapshot(&config_path)?;
        if snapshot.providers.is_empty()
            && snapshot.active_provider_key.is_none()
            && snapshot.model.is_none()
        {
            warnings.push("Codex config.toml is empty.".to_string());
        } else {
            active_provider_key = snapshot.active_provider_key.clone();
            model = snapshot.model.clone();
            base_url = snapshot
                .providers
                .iter()
                .find(|provider| provider.is_active)
                .and_then(|provider| provider.base_url.clone());
            live_providers = snapshot
                .providers
                .into_iter()
                .map(|provider| DesktopCodexLiveProvider {
                    id: provider.key,
                    name: provider.name,
                    base_url: provider.base_url,
                    wire_api: provider.wire_api,
                    requires_openai_auth: provider.requires_openai_auth,
                    model: provider.model,
                    is_active: provider.is_active,
                })
                .collect();
        }
    }

    if !auth_path.exists() {
        warnings.push("Codex auth.json does not exist yet.".to_string());
    }
    if active_provider_key.is_none() {
        warnings.push("Codex model_provider is not configured.".to_string());
    }
    if model.is_none() {
        warnings.push("Codex model is not configured.".to_string());
    }

    Ok(DesktopCodexRuntimeState {
        config_dir: config_dir.display().to_string(),
        auth_path: auth_path.display().to_string(),
        config_path: config_path.display().to_string(),
        active_provider_key,
        model,
        base_url,
        provider_count: live_providers.len(),
        has_api_key,
        has_chatgpt_tokens,
        auth_mode,
        auth_profile_label: auth_claims.as_ref().and_then(|claims| claims.email.clone()),
        auth_plan_type: auth_claims
            .as_ref()
            .and_then(|claims| claims.chatgpt_plan_type.clone()),
        live_providers,
        health_warnings: warnings,
    })
}

pub fn codex_oauth_models() -> Vec<DesktopProviderModel> {
    let cache = CODEX_OPENAI_MODELS_CACHE.get_or_init(|| Mutex::new(None));
    if let Ok(guard) = cache.lock() {
        if let Some(cached) = guard.as_ref() {
            if cached.fetched_at.elapsed() < CODEX_MODEL_DISCOVERY_CACHE_TTL {
                return cached.models.clone();
            }
        }
    }

    let models = match discover_codex_openai_models_with_timeout() {
        Ok(models) if !models.is_empty() => models,
        _ => static_codex_openai_models(),
    };

    if let Ok(mut guard) = cache.lock() {
        *guard = Some(CachedCodexModels {
            fetched_at: Instant::now(),
            models: models.clone(),
        });
    }

    models
}

fn load_codex_config_snapshot(config_path: &PathBuf) -> Result<CodexConfigSnapshot, String> {
    let config_text = fs::read_to_string(config_path).map_err(|error| {
        format!(
            "read codex config failed ({}): {error}",
            config_path.display()
        )
    })?;
    if config_text.trim().is_empty() {
        return Ok(CodexConfigSnapshot {
            active_provider_key: None,
            model: None,
            providers: Vec::new(),
        });
    }

    let document = config_text.parse::<DocumentMut>().map_err(|error| {
        format!(
            "parse codex config failed ({}): {error}",
            config_path.display()
        )
    })?;
    let active_provider_key = toml_string(document.get("model_provider"));
    let model = toml_string(document.get("model"));
    let providers = document
        .get("model_providers")
        .and_then(Item::as_table_like)
        .map(|table| {
            table
                .iter()
                .filter_map(|(key, item)| {
                    let table = item.as_table_like()?;
                    let base_url = table
                        .get("base_url")
                        .and_then(Item::as_value)
                        .and_then(toml_edit::Value::as_str)
                        .map(str::to_string);
                    let name = table
                        .get("name")
                        .and_then(Item::as_value)
                        .and_then(toml_edit::Value::as_str)
                        .map(str::to_string);
                    let wire_api = table
                        .get("wire_api")
                        .and_then(Item::as_value)
                        .and_then(toml_edit::Value::as_str)
                        .map(str::to_string);
                    let requires_openai_auth = table
                        .get("requires_openai_auth")
                        .and_then(Item::as_value)
                        .and_then(toml_edit::Value::as_bool)
                        .unwrap_or(false);
                    let is_active = active_provider_key.as_deref() == Some(key);
                    Some(CodexLiveProviderEntry {
                        key: key.to_string(),
                        name,
                        base_url,
                        wire_api,
                        requires_openai_auth,
                        model: is_active.then(|| model.clone()).flatten(),
                        is_active,
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(CodexConfigSnapshot {
        active_provider_key,
        model,
        providers,
    })
}

fn static_codex_openai_models() -> Vec<DesktopProviderModel> {
    vec![
        model("gpt-5.4", "GPT-5.4", &["coding", "reasoning"]),
        model("gpt-5.4-mini", "GPT-5.4-Mini", &["coding", "reasoning"]),
        model("gpt-5.3-codex", "GPT-5.3-Codex", &["coding", "reasoning"]),
        model(
            "gpt-5.3-codex-spark",
            "GPT-5.3-Codex-Spark",
            &["coding", "fast"],
        ),
        model("gpt-5.2-codex", "GPT-5.2-Codex", &["coding", "reasoning"]),
        model("gpt-5.2", "GPT-5.2", &["general", "reasoning"]),
        model(
            "gpt-5.1-codex-max",
            "GPT-5.1-Codex-Max",
            &["coding", "reasoning"],
        ),
        model("gpt-5.1-codex-mini", "GPT-5.1-Codex-Mini", &["coding"]),
    ]
}

fn discover_codex_openai_models_with_timeout() -> Result<Vec<DesktopProviderModel>, String> {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(discover_codex_openai_models_once());
    });

    match rx.recv_timeout(CODEX_MODEL_DISCOVERY_TIMEOUT) {
        Ok(result) => result,
        Err(mpsc::RecvTimeoutError::Timeout) => {
            Err("timed out while querying Codex app-server model/list".to_string())
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            Err("Codex app-server model discovery worker disconnected".to_string())
        }
    }
}

fn discover_codex_openai_models_once() -> Result<Vec<DesktopProviderModel>, String> {
    let mut child = Command::new("codex")
        .arg("app-server")
        .arg("--listen")
        .arg("stdio://")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("spawn codex app-server failed: {error}"))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "codex app-server stdin unavailable".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "codex app-server stdout unavailable".to_string())?;
    let mut reader = BufReader::new(stdout);

    write_codex_app_server_request(
        &mut stdin,
        CODEX_APP_SERVER_INITIALIZE_ID,
        "initialize",
        json!({
            "clientInfo": {
                "name": "warwolf",
                "version": env!("CARGO_PKG_VERSION"),
            }
        }),
    )?;
    let initialize_result =
        read_codex_app_server_result(&mut reader, CODEX_APP_SERVER_INITIALIZE_ID)?;
    let _: CodexAppServerInitializeResult = serde_json::from_value(initialize_result)
        .map_err(|error| format!("parse codex app-server initialize result failed: {error}"))?;

    write_codex_app_server_request(
        &mut stdin,
        CODEX_APP_SERVER_MODEL_LIST_ID,
        "model/list",
        json!({
            "limit": 100,
            "includeHidden": false,
        }),
    )?;
    let model_list_result =
        read_codex_app_server_result(&mut reader, CODEX_APP_SERVER_MODEL_LIST_ID)?;

    drop(stdin);
    let _ = child.kill();
    let _ = child.wait();

    let payload = serde_json::from_value::<CodexAppServerModelListResult>(model_list_result)
        .map_err(|error| format!("parse codex app-server model/list result failed: {error}"))?;

    let models = payload
        .data
        .into_iter()
        .filter(|entry| !entry.hidden)
        .map(codex_model_entry_to_provider_model)
        .collect::<Vec<_>>();

    if models.is_empty() {
        return Err("Codex app-server returned an empty model list".to_string());
    }

    Ok(models)
}

fn write_codex_app_server_request(
    stdin: &mut impl Write,
    id: u64,
    method: &str,
    params: Value,
) -> Result<(), String> {
    let payload = json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params,
    });
    let encoded = serde_json::to_string(&payload)
        .map_err(|error| format!("serialize codex app-server request failed: {error}"))?;
    stdin
        .write_all(encoded.as_bytes())
        .and_then(|_| stdin.write_all(b"\n"))
        .and_then(|_| stdin.flush())
        .map_err(|error| format!("write codex app-server request failed: {error}"))
}

fn read_codex_app_server_result(
    reader: &mut impl BufRead,
    request_id: u64,
) -> Result<Value, String> {
    loop {
        let mut line = String::new();
        let bytes = reader
            .read_line(&mut line)
            .map_err(|error| format!("read codex app-server response failed: {error}"))?;
        if bytes == 0 {
            return Err(format!(
                "codex app-server closed before responding to request {request_id}"
            ));
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let payload = serde_json::from_str::<Value>(trimmed).map_err(|error| {
            format!("parse codex app-server response failed: {error}; line={trimmed}")
        })?;
        if payload.get("id").and_then(Value::as_u64) != Some(request_id) {
            continue;
        }
        if let Some(error) = payload.get("error") {
            return Err(format!(
                "codex app-server request {request_id} failed: {error}"
            ));
        }
        if let Some(result) = payload.get("result") {
            return Ok(result.clone());
        }
        return Err(format!(
            "codex app-server response for request {request_id} did not contain a result"
        ));
    }
}

fn codex_model_entry_to_provider_model(entry: CodexAppServerModelEntry) -> DesktopProviderModel {
    let model_id = entry.model.clone().unwrap_or(entry.id.clone());
    let display_name = normalize_codex_model_display_name(entry.display_name.as_deref(), &model_id);
    let mut capability_tags = Vec::new();
    let description = entry.description.unwrap_or_default().to_lowercase();

    if description.contains("coding") || description.contains("codex") {
        capability_tags.push("coding".to_string());
    }
    if !entry.supported_reasoning_efforts.is_empty()
        && (entry.supported_reasoning_efforts.len() > 1 || description.contains("reason"))
    {
        capability_tags.push("reasoning".to_string());
    }
    if entry
        .input_modalities
        .iter()
        .any(|modality| modality.eq_ignore_ascii_case("image"))
    {
        capability_tags.push("image".to_string());
    }
    if capability_tags.is_empty() || entry.is_default {
        capability_tags.insert(0, "general".to_string());
    }
    capability_tags.dedup();

    DesktopProviderModel {
        model_id,
        display_name,
        context_window: None,
        max_output_tokens: None,
        billing_kind: Some("paid".to_string()),
        capability_tags,
    }
}

fn normalize_codex_model_display_name(display_name: Option<&str>, model_id: &str) -> String {
    if let Some(display_name) = display_name {
        let trimmed = display_name.trim();
        if !trimmed.is_empty() && trimmed != model_id {
            return trimmed.to_string();
        }
    }

    model_id
        .split('-')
        .map(|part| {
            if part.eq_ignore_ascii_case("gpt") {
                return "GPT".to_string();
            }
            if part.chars().all(|ch| ch.is_ascii_digit() || ch == '.') {
                return part.to_string();
            }
            let mut chars = part.chars();
            let Some(first) = chars.next() else {
                return String::new();
            };
            format!("{}{}", first.to_ascii_uppercase(), chars.as_str())
        })
        .collect::<Vec<_>>()
        .join("-")
}

fn model(model_id: &str, display_name: &str, capability_tags: &[&str]) -> DesktopProviderModel {
    DesktopProviderModel {
        model_id: model_id.to_string(),
        display_name: display_name.to_string(),
        context_window: Some(200000),
        max_output_tokens: Some(16384),
        billing_kind: Some("paid".to_string()),
        capability_tags: capability_tags
            .iter()
            .map(|value| (*value).to_string())
            .collect(),
    }
}

fn toml_string(item: Option<&Item>) -> Option<String> {
    item.and_then(Item::as_value)
        .and_then(toml_edit::Value::as_str)
        .map(str::to_string)
}

fn resolve_codex_config_dir() -> PathBuf {
    if let Ok(value) = std::env::var("CODEX_HOME") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    current_home_dir().join(".codex")
}

fn current_home_dir() -> PathBuf {
    PathBuf::from(
        std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .or_else(|_| std::env::var("LOCALAPPDATA"))
            .unwrap_or_else(|_| ".".to_string()),
    )
}

#[allow(dead_code)]
fn _codex_config_exists() -> bool {
    Path::new(&resolve_codex_config_dir().join(DEFAULT_CODEX_CONFIG_FILE)).exists()
}
