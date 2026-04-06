pub mod error;
pub mod providers {
    pub mod streaming;
    pub mod streaming_responses;
    pub mod transform;
    pub mod transform_responses;
}
pub mod sse;

use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::header::{CACHE_CONTROL, CONNECTION, CONTENT_TYPE};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use bytes::Bytes;
use desktop_core::{DesktopManagedAuthProviderKind, DesktopStateError};
use futures::Stream;
use futures::StreamExt;
use serde_json::json;
use serde_json::Value;

use self::error::ProxyError;
use crate::AppState;

enum UpstreamApiFormat {
    OpenAiChat,
    OpenAiResponses,
}

const DEFAULT_CODE_TOOL_SYSTEM_PROMPT: &str = "You are a coding assistant.";

pub async fn ready(
    State(state): State<AppState>,
    Path(provider_id): Path<String>,
) -> Result<impl IntoResponse, ProxyError> {
    state
        .desktop()
        .managed_auth_runtime_client(&provider_id)
        .await
        .map_err(map_desktop_error)?;
    Ok(StatusCode::OK)
}

pub async fn handle_messages(
    State(state): State<AppState>,
    Path(provider_id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Response, ProxyError> {
    let runtime_client = state
        .desktop()
        .managed_auth_runtime_client(&provider_id)
        .await
        .map_err(map_desktop_error)?;
    let stream_requested = body.get("stream").and_then(Value::as_bool).unwrap_or(false);

    let (upstream_api, upstream_url, mut upstream_body, upstream_requires_stream) =
        match runtime_client.provider_kind {
            DesktopManagedAuthProviderKind::CodexOpenai => (
                UpstreamApiFormat::OpenAiResponses,
                build_upstream_url(&runtime_client.base_url, "/responses"),
                providers::transform_responses::anthropic_to_responses(body, None)?,
                true,
            ),
            DesktopManagedAuthProviderKind::QwenCode => (
                UpstreamApiFormat::OpenAiChat,
                build_upstream_url(&runtime_client.base_url, "/chat/completions"),
                providers::transform::anthropic_to_openai(body, None)?,
                false,
            ),
        };

    match runtime_client.provider_kind {
        DesktopManagedAuthProviderKind::CodexOpenai => {
            ensure_responses_instructions(&mut upstream_body, DEFAULT_CODE_TOOL_SYSTEM_PROMPT);
            if let Some(object) = upstream_body.as_object_mut() {
                object.remove("max_output_tokens");
            }
            upstream_body["store"] = json!(false);
            upstream_body["stream"] = json!(true);
        }
        DesktopManagedAuthProviderKind::QwenCode => {
            ensure_openai_system_message(&mut upstream_body, DEFAULT_CODE_TOOL_SYSTEM_PROMPT);
        }
    }

    let upstream_stream_requested = upstream_requires_stream || stream_requested;
    if !upstream_requires_stream {
        upstream_body["stream"] = json!(stream_requested);
    };

    let upstream_response = forward_json_request(
        &upstream_url,
        runtime_client.bearer_token,
        runtime_client.extra_headers,
        upstream_body,
    )
    .await?;

    if upstream_stream_requested && !stream_requested {
        let upstream_json = match upstream_api {
            UpstreamApiFormat::OpenAiResponses => {
                collect_responses_completion(upstream_response).await?
            }
            UpstreamApiFormat::OpenAiChat => {
                return Err(ProxyError::ForwardFailed(
                    "unexpected upstream streaming mode for OpenAI chat provider".to_string(),
                ));
            }
        };
        let anthropic_json = providers::transform_responses::responses_to_anthropic(upstream_json)?;
        return Ok(Json(anthropic_json).into_response());
    }

    if stream_requested {
        let stream = upstream_response.bytes_stream();
        return match upstream_api {
            UpstreamApiFormat::OpenAiChat => Ok(sse_response(
                providers::streaming::create_anthropic_sse_stream(stream),
            )),
            UpstreamApiFormat::OpenAiResponses => Ok(sse_response(
                providers::streaming_responses::create_anthropic_sse_stream_from_responses(stream),
            )),
        };
    }

    let upstream_json = upstream_response.json::<Value>().await.map_err(|error| {
        ProxyError::ForwardFailed(format!("decode upstream response failed: {error}"))
    })?;

    let anthropic_json = match upstream_api {
        UpstreamApiFormat::OpenAiChat => providers::transform::openai_to_anthropic(upstream_json)?,
        UpstreamApiFormat::OpenAiResponses => {
            providers::transform_responses::responses_to_anthropic(upstream_json)?
        }
    };

    Ok(Json(anthropic_json).into_response())
}

fn build_upstream_url(base_url: &str, path: &str) -> String {
    format!("{}{}", base_url.trim_end_matches('/'), path)
}

fn ensure_openai_system_message(payload: &mut Value, default_system: &str) {
    let Some(messages) = payload.get_mut("messages").and_then(Value::as_array_mut) else {
        return;
    };
    let has_system = matches!(
        messages
            .first()
            .and_then(|item| item.get("role"))
            .and_then(Value::as_str),
        Some("system")
    );
    if !has_system {
        messages.insert(0, json!({ "role": "system", "content": default_system }));
    }
}

fn ensure_responses_instructions(payload: &mut Value, default_instructions: &str) {
    let missing = payload
        .get("instructions")
        .and_then(Value::as_str)
        .map(|value| value.trim().is_empty())
        .unwrap_or(true);
    if missing {
        payload["instructions"] = json!(default_instructions);
    }
}

async fn forward_json_request(
    url: &str,
    bearer_token: String,
    extra_headers: std::collections::HashMap<String, String>,
    payload: Value,
) -> Result<reqwest::Response, ProxyError> {
    let client = reqwest::Client::new();
    let mut request = client
        .post(url)
        .bearer_auth(bearer_token)
        .header(CONTENT_TYPE.as_str(), "application/json")
        .header("Accept", "application/json, text/event-stream")
        .json(&payload);

    for (key, value) in extra_headers {
        request = request.header(&key, &value);
    }

    let response = request
        .send()
        .await
        .map_err(|error| ProxyError::ForwardFailed(format!("forward request failed: {error}")))?;

    if response.status().is_success() {
        return Ok(response);
    }

    let status = response.status().as_u16();
    let body = response.text().await.ok();
    Err(ProxyError::UpstreamError { status, body })
}

async fn collect_responses_completion(
    upstream_response: reqwest::Response,
) -> Result<Value, ProxyError> {
    let mut buffer = String::new();
    let mut stream = upstream_response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|error| {
            ProxyError::ForwardFailed(format!("read upstream responses stream failed: {error}"))
        })?;
        let text = String::from_utf8_lossy(&bytes);
        buffer.push_str(&text);
        if buffer.contains("\r\n") {
            buffer = buffer.replace("\r\n", "\n");
        }

        while let Some(pos) = buffer.find("\n\n") {
            let block = buffer[..pos].to_string();
            buffer = buffer[pos + 2..].to_string();

            if block.trim().is_empty() {
                continue;
            }

            let mut event_type: Option<String> = None;
            let mut data_parts: Vec<String> = Vec::new();
            for line in block.lines() {
                if let Some(evt) = sse::strip_sse_field(line, "event") {
                    event_type = Some(evt.trim().to_string());
                } else if let Some(data) = sse::strip_sse_field(line, "data") {
                    data_parts.push(data.to_string());
                }
            }

            if data_parts.is_empty() {
                continue;
            }

            let data_str = data_parts.join("\n");
            let data = serde_json::from_str::<Value>(&data_str).map_err(|error| {
                ProxyError::ForwardFailed(format!(
                    "decode upstream responses SSE payload failed: {error}"
                ))
            })?;

            match event_type.as_deref().unwrap_or("") {
                "response.completed" => {
                    return Ok(data.get("response").cloned().unwrap_or(data));
                }
                "error" => {
                    return Err(ProxyError::UpstreamError {
                        status: StatusCode::BAD_GATEWAY.as_u16(),
                        body: Some(data.to_string()),
                    });
                }
                _ => {}
            }
        }
    }

    Err(ProxyError::ForwardFailed(
        "upstream responses stream ended before response.completed".to_string(),
    ))
}

fn sse_response<S>(stream: S) -> Response
where
    S: Stream<Item = Result<Bytes, std::io::Error>> + Send + 'static,
{
    Response::builder()
        .status(StatusCode::OK)
        .header(CONTENT_TYPE, "text/event-stream")
        .header(CACHE_CONTROL, "no-cache")
        .header(CONNECTION, "keep-alive")
        .body(Body::from_stream(stream))
        .expect("SSE response should build")
}

fn map_desktop_error(error: DesktopStateError) -> ProxyError {
    ProxyError::ConfigError(error.to_string())
}
