use crate::tunnel_config::ConnectParams;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

pub const VERSION: u8 = 1;
pub const MAX_MESSAGE_BYTES: usize = 16 * 1024;

pub fn authorization_request_id(input: &[u8]) -> Option<u64> {
    serde_json::from_slice::<Request>(input)
        .ok()
        .filter(|request| request.v == VERSION)
        .filter(|request| {
            matches!(
                request.method.as_str(),
                "connect" | "disconnect" | "recover"
            )
        })
        .map(|request| request.id)
}

pub fn status_request_id(input: &[u8]) -> Option<u64> {
    serde_json::from_slice::<Request>(input)
        .ok()
        .filter(|request| request.v == VERSION && request.method == "status")
        .filter(|request| empty_params(&request.params))
        .map(|request| request.id)
}

/// `verify` only observes the tunnel (it never changes networking), so like
/// `status` it needs no authorization.
pub fn verify_request_id(input: &[u8]) -> Option<u64> {
    serde_json::from_slice::<Request>(input)
        .ok()
        .filter(|request| request.v == VERSION && request.method == "verify")
        .filter(|request| empty_params(&request.params))
        .map(|request| request.id)
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    v: u8,
    id: u64,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Debug, Serialize)]
struct Response<'a> {
    v: u8,
    id: u64,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<ErrorBody<'a>>,
}

#[derive(Debug, Serialize)]
struct ErrorBody<'a> {
    code: &'a str,
    message: &'a str,
}

pub enum Mutation {
    Connect {
        id: u64,
        #[cfg_attr(not(unix), allow(dead_code))]
        params: Box<ConnectParams>,
    },
    Disconnect {
        id: u64,
    },
    Recover {
        id: u64,
    },
}

impl Mutation {
    pub fn id(&self) -> u64 {
        match self {
            Self::Connect { id, .. } | Self::Disconnect { id } | Self::Recover { id } => *id,
        }
    }
}

pub fn parse_mutation(input: &[u8]) -> Option<Result<Mutation, u64>> {
    let request = serde_json::from_slice::<Request>(input).ok()?;
    if request.v != VERSION {
        return None;
    }
    match request.method.as_str() {
        "connect" => Some(
            serde_json::from_value::<ConnectParams>(request.params)
                .ok()
                .filter(|params| params.validate().is_ok())
                .map(|params| Mutation::Connect {
                    id: request.id,
                    params: Box::new(params),
                })
                .ok_or(request.id),
        ),
        "disconnect" if empty_params(&request.params) => {
            Some(Ok(Mutation::Disconnect { id: request.id }))
        }
        "recover" if empty_params(&request.params) => {
            Some(Ok(Mutation::Recover { id: request.id }))
        }
        "disconnect" | "recover" => Some(Err(request.id)),
        _ => None,
    }
}

pub fn success(id: u64, result: Value) -> Vec<u8> {
    serialize(Response {
        v: VERSION,
        id,
        ok: true,
        result: Some(result),
        error: None,
    })
}

pub fn error(id: u64, code: &'static str, message: &'static str) -> Vec<u8> {
    serialize(Response {
        v: VERSION,
        id,
        ok: false,
        result: None,
        error: Some(ErrorBody { code, message }),
    })
}

fn serialize(response: Response<'_>) -> Vec<u8> {
    let mut bytes = serde_json::to_vec(&response).expect("response types are serializable");
    bytes.push(b'\n');
    bytes
}

fn empty_params(params: &Value) -> bool {
    params.is_null() || params.as_object().is_some_and(serde_json::Map::is_empty)
}

pub fn handle(input: &[u8], recovery_required: bool) -> Vec<u8> {
    if input.len() > MAX_MESSAGE_BYTES {
        return error(0, "message_too_large", "request exceeds the protocol limit");
    }

    let request: Request = match serde_json::from_slice(input) {
        Ok(request) => request,
        Err(_) => return error(0, "invalid_request", "request is not valid protocol JSON"),
    };

    if request.v != VERSION {
        return error(
            request.id,
            "unsupported_version",
            "unsupported protocol version",
        );
    }
    match request.method.as_str() {
        "ping" if empty_params(&request.params) => success(
            request.id,
            json!({ "service": "k1vpnd", "version": env!("CARGO_PKG_VERSION") }),
        ),
        "status" if empty_params(&request.params) => success(
            request.id,
            json!({
                "state": "disconnected",
                "recovery_required": recovery_required,
                "last_handshake_secs_ago": null,
                "rx_bytes": null
            }),
        ),
        "disconnect" | "recover" | "verify" if empty_params(&request.params) => error(
            request.id,
            "backend_unavailable",
            "the Linux tunnel backend is not available yet",
        ),
        "ping" | "status" | "disconnect" | "recover" | "verify" => error(
            request.id,
            "invalid_params",
            "this method accepts no parameters",
        ),
        "connect" => match serde_json::from_value::<ConnectParams>(request.params) {
            Ok(params) if params.validate().is_ok() => error(
                request.id,
                "backend_unavailable",
                "the Linux tunnel backend is not available yet",
            ),
            _ => error(
                request.id,
                "invalid_tunnel_config",
                "the tunnel configuration is invalid",
            ),
        },
        _ => error(request.id, "method_not_found", "method is not available"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn value(bytes: Vec<u8>) -> Value {
        serde_json::from_slice(&bytes).unwrap()
    }

    #[test]
    fn ping_returns_the_versioned_service_identity() {
        let response = value(handle(
            br#"{"v":1,"id":7,"method":"ping","params":{}}"#,
            false,
        ));
        assert_eq!(response["v"], 1);
        assert_eq!(response["id"], 7);
        assert_eq!(response["ok"], true);
        assert_eq!(response["result"]["service"], "k1vpnd");
    }

    #[test]
    fn status_is_honestly_disconnected_until_a_tunnel_manager_exists() {
        let response = value(handle(br#"{"v":1,"id":8,"method":"status"}"#, false));
        assert_eq!(response["result"]["state"], "disconnected");
        assert_eq!(response["result"]["recovery_required"], false);
        assert!(response["result"]["last_handshake_secs_ago"].is_null());
    }

    #[test]
    fn rejects_unknown_fields_versions_methods_and_parameters() {
        let cases = [
            (
                br#"{"v":1,"id":1,"method":"ping","extra":true}"#.as_slice(),
                "invalid_request",
            ),
            (
                br#"{"v":2,"id":2,"method":"ping"}"#.as_slice(),
                "unsupported_version",
            ),
            (
                br#"{"v":1,"id":3,"method":"connect"}"#.as_slice(),
                "invalid_tunnel_config",
            ),
            (
                br#"{"v":1,"id":4,"method":"ping","params":{"x":1}}"#.as_slice(),
                "invalid_params",
            ),
        ];
        for (request, expected) in cases {
            assert_eq!(value(handle(request, false))["error"]["code"], expected);
        }
    }

    #[test]
    fn bounds_and_sanitizes_malformed_input() {
        assert_eq!(
            value(handle(b"not-json", false))["error"]["code"],
            "invalid_request"
        );
        let oversized = vec![b'x'; MAX_MESSAGE_BYTES + 1];
        assert_eq!(
            value(handle(&oversized, false))["error"]["code"],
            "message_too_large"
        );
    }

    #[test]
    fn only_known_mutating_methods_require_authorization() {
        assert_eq!(
            authorization_request_id(br#"{"v":1,"id":1,"method":"connect","params":{}}"#),
            Some(1)
        );
        assert_eq!(
            authorization_request_id(br#"{"v":1,"id":2,"method":"disconnect"}"#),
            Some(2)
        );
        assert_eq!(
            authorization_request_id(br#"{"v":2,"id":3,"method":"connect"}"#),
            None
        );
        assert_eq!(
            authorization_request_id(br#"{"v":1,"id":4,"method":"status"}"#),
            None
        );
        assert_eq!(authorization_request_id(b"not-json"), None);
        assert_eq!(
            authorization_request_id(br#"{"v":1,"id":5,"method":"verify"}"#),
            None
        );
        assert_eq!(
            verify_request_id(br#"{"v":1,"id":5,"method":"verify","params":{}}"#),
            Some(5)
        );
        assert_eq!(
            verify_request_id(br#"{"v":1,"id":6,"method":"verify","params":{"x":1}}"#),
            None
        );
    }

    #[test]
    fn recognizes_status_and_mutation_envelopes() {
        assert_eq!(
            status_request_id(br#"{"v":1,"id":21,"method":"status","params":{}}"#),
            Some(21)
        );
        assert_eq!(
            status_request_id(br#"{"v":1,"id":22,"method":"status","params":{"x":1}}"#),
            None
        );
        let mutation = parse_mutation(br#"{"v":1,"id":23,"method":"disconnect"}"#)
            .unwrap()
            .unwrap();
        assert_eq!(mutation.id(), 23);
        assert!(
            parse_mutation(br#"{"v":1,"id":24,"method":"recover","params":{"x":1}}"#)
                .unwrap()
                .is_err()
        );
    }

    #[test]
    fn status_surfaces_recovery_state() {
        let response = value(handle(br#"{"v":1,"id":9,"method":"status"}"#, true));
        assert_eq!(response["result"]["recovery_required"], true);
    }
}
