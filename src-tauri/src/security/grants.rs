//! Prepare → authorize → run (SECURITY.md §5).
//!
//! `prepare` records exactly what will run (the binding) and what it needs.
//! `authorize` issues a single-use grant for that prepared run. `take` consumes
//! the prepared run once, checks the grant, and the caller re-derives the
//! binding and compares. Skipped steps, replays, swapped ids, stale entries and
//! anything that changed after authorization are rejected.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::error::{AppError, AppResult};

pub const TTL: Duration = Duration::from_secs(60);
const MAX_PENDING: usize = 32;

/// What a prepared run requires before it may start.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Needs {
    pub confirmation: bool,
    /// Text the user must type (irreversible operations).
    pub phrase: Option<String>,
    pub password: bool,
}

#[derive(Debug, Clone)]
pub struct Pending {
    pub command_id: String,
    pub params: Vec<(String, String)>,
    /// Shell, resolved text, working folder and elevation, as one string.
    pub binding: String,
    pub needs: Needs,
    created: Instant,
    grant: Option<(String, Instant)>,
}

#[derive(Default)]
pub struct Grants {
    pending: Mutex<HashMap<String, Pending>>,
}

fn token() -> AppResult<String> {
    let bytes: [u8; 16] = super::password::random_bytes()?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

fn expired() -> AppError {
    AppError::Conflict("This run expired or was already used. Start it again.".into())
}

impl Grants {
    fn lock(&self) -> AppResult<std::sync::MutexGuard<'_, HashMap<String, Pending>>> {
        self.pending
            .lock()
            .map_err(|_| AppError::Internal("grant lock poisoned".into()))
    }

    pub fn prepare(
        &self,
        command_id: &str,
        params: Vec<(String, String)>,
        binding: String,
        needs: Needs,
        now: Instant,
    ) -> AppResult<String> {
        let id = token()?;
        let mut map = self.lock()?;
        map.retain(|_, p| now.duration_since(p.created) < TTL);
        if map.len() >= MAX_PENDING {
            // Oldest first: a busy UI never blocks itself.
            if let Some(oldest) = map
                .iter()
                .min_by_key(|(_, p)| p.created)
                .map(|(k, _)| k.clone())
            {
                map.remove(&oldest);
            }
        }
        map.insert(
            id.clone(),
            Pending {
                command_id: command_id.into(),
                params,
                binding,
                needs,
                created: now,
                grant: None,
            },
        );
        Ok(id)
    }

    /// What a prepared run needs (for authorization checks by the caller).
    pub fn needs(&self, prepare_id: &str, now: Instant) -> AppResult<Needs> {
        let map = self.lock()?;
        let p = map
            .get(prepare_id)
            .filter(|p| now.duration_since(p.created) < TTL)
            .ok_or_else(expired)?;
        Ok(p.needs.clone())
    }

    /// Issues the single-use grant. The caller has verified confirmation and password.
    pub fn authorize(&self, prepare_id: &str, now: Instant) -> AppResult<String> {
        let grant = token()?;
        let mut map = self.lock()?;
        let p = map
            .get_mut(prepare_id)
            .filter(|p| now.duration_since(p.created) < TTL)
            .ok_or_else(expired)?;
        p.grant = Some((grant.clone(), now));
        Ok(grant)
    }

    /// Consumes the prepared run. Fails unless the grant (when one is needed) matches and is fresh.
    pub fn take(&self, prepare_id: &str, grant: Option<&str>, now: Instant) -> AppResult<Pending> {
        let mut map = self.lock()?;
        let p = map.remove(prepare_id).ok_or_else(expired)?;
        if now.duration_since(p.created) >= TTL {
            return Err(expired());
        }
        if p.needs.confirmation || p.needs.password {
            let ok = match (&p.grant, grant) {
                (Some((issued, at)), Some(given)) => {
                    super::password::constant_time_eq(issued.as_bytes(), given.as_bytes())
                        && now.duration_since(*at) < TTL
                }
                _ => false,
            };
            if !ok {
                return Err(AppError::Conflict(
                    "This run wasn't confirmed. Start it again.".into(),
                ));
            }
        }
        Ok(p)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn needs(confirmation: bool) -> Needs {
        Needs {
            confirmation,
            phrase: None,
            password: false,
        }
    }

    #[test]
    fn routine_runs_need_no_grant_but_are_single_use() {
        let g = Grants::default();
        let t = Instant::now();
        let id = g.prepare("a", vec![], "b".into(), needs(false), t).unwrap();
        assert_eq!(g.take(&id, None, t).unwrap().command_id, "a");
        assert!(g.take(&id, None, t).is_err(), "replay");
    }

    #[test]
    fn confirmed_runs_need_their_own_fresh_grant() {
        let g = Grants::default();
        let t = Instant::now();
        let a = g.prepare("a", vec![], "x".into(), needs(true), t).unwrap();
        let b = g.prepare("b", vec![], "y".into(), needs(true), t).unwrap();
        assert!(g.take(&a, None, t).is_err(), "skipped authorize");

        let a = g.prepare("a", vec![], "x".into(), needs(true), t).unwrap();
        let grant_b = g.authorize(&b, t).unwrap();
        assert!(
            g.take(&a, Some(&grant_b), t).is_err(),
            "grant for another run"
        );

        let a = g.prepare("a", vec![], "x".into(), needs(true), t).unwrap();
        let grant = g.authorize(&a, t).unwrap();
        assert!(
            g.take(&a, Some("0".repeat(32).as_str()), t).is_err(),
            "forged grant"
        );

        let a = g.prepare("a", vec![], "x".into(), needs(true), t).unwrap();
        let grant_a = g.authorize(&a, t).unwrap();
        assert_eq!(g.take(&a, Some(&grant_a), t).unwrap().binding, "x");
        assert!(g.take(&a, Some(&grant_a), t).is_err(), "replayed grant");
        assert_ne!(grant, grant_a);
    }

    #[test]
    fn everything_expires_after_the_ttl() {
        let g = Grants::default();
        let t = Instant::now();
        let id = g.prepare("a", vec![], "x".into(), needs(true), t).unwrap();
        assert!(g.authorize(&id, t + TTL).is_err());
        let id = g.prepare("a", vec![], "x".into(), needs(true), t).unwrap();
        let grant = g.authorize(&id, t).unwrap();
        assert!(g.take(&id, Some(&grant), t + TTL).is_err());
        let id = g.prepare("a", vec![], "x".into(), needs(false), t).unwrap();
        assert!(
            g.take(&id, None, t + TTL + Duration::from_millis(1))
                .is_err()
        );
    }

    #[test]
    fn pending_entries_are_bounded() {
        let g = Grants::default();
        let t = Instant::now();
        let first = g.prepare("a", vec![], "x".into(), needs(false), t).unwrap();
        for i in 0..MAX_PENDING {
            g.prepare(
                "a",
                vec![],
                "x".into(),
                needs(false),
                t + Duration::from_millis(i as u64 + 1),
            )
            .unwrap();
        }
        assert!(g.take(&first, None, t).is_err(), "oldest evicted");
        assert!(g.lock().unwrap().len() <= MAX_PENDING);
    }
}
