//! Errors returned to the frontend as `{ kind, message, fields? }`.

use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FieldError {
    pub field: String,
    pub message: String,
}

impl FieldError {
    pub fn new(field: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            field: field.into(),
            message: message.into(),
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    NotFound(String),
    #[error("Some fields are invalid")]
    Validation(Vec<FieldError>),
    #[error("{0}")]
    Limit(String),
    #[error("{0}")]
    Conflict(String),
    #[error("Storage error: {0}")]
    Storage(String),
    #[error("Internal error: {0}")]
    Internal(String),
}

impl AppError {
    pub fn invalid(field: &str, message: &str) -> Self {
        AppError::Validation(vec![FieldError::new(field, message)])
    }

    fn kind(&self) -> &'static str {
        match self {
            AppError::NotFound(_) => "notFound",
            AppError::Validation(_) => "validation",
            AppError::Limit(_) => "limit",
            AppError::Conflict(_) => "conflict",
            AppError::Storage(_) => "storage",
            AppError::Internal(_) => "internal",
        }
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::Storage(e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Storage(format!("stored data could not be read: {e}"))
    }
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("AppError", 3)?;
        s.serialize_field("kind", self.kind())?;
        s.serialize_field("message", &self.to_string())?;
        match self {
            AppError::Validation(fields) => s.serialize_field("fields", fields)?,
            _ => s.skip_field("fields")?,
        }
        s.end()
    }
}

pub type AppResult<T> = Result<T, AppError>;
