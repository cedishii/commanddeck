//! Optional app password (SECURITY.md §8): Argon2id, constant-time comparison,
//! rate-limited attempts. A guard against mistakes and casual use of an
//! unlocked PC, not a security boundary.

use std::time::{Duration, Instant};

use argon2::{Algorithm, Argon2, Params, Version};
use base64::Engine;
use base64::engine::general_purpose::STANDARD_NO_PAD as B64;

use crate::error::{AppError, AppResult};

pub const MIN_LEN: usize = 6;
pub const MAX_LEN: usize = 128;
const SALT_LEN: usize = 16;
const HASH_LEN: usize = 32;
/// Failures allowed before waiting kicks in.
const FREE_ATTEMPTS: u32 = 3;
const MAX_WAIT: Duration = Duration::from_secs(300);

/// OWASP's minimum recommendation for Argon2id: 19 MiB, 2 iterations, 1 lane.
fn params() -> AppResult<Params> {
    Params::new(19 * 1024, 2, 1, Some(HASH_LEN))
        .map_err(|e| AppError::Internal(format!("password parameters: {e}")))
}

pub fn validate_new(password: &str) -> AppResult<()> {
    let len = password.chars().count();
    if len < MIN_LEN {
        Err(AppError::invalid(
            "password",
            &format!("Use at least {MIN_LEN} characters."),
        ))
    } else if len > MAX_LEN {
        Err(AppError::invalid(
            "password",
            &format!("Use at most {MAX_LEN} characters."),
        ))
    } else {
        Ok(())
    }
}

fn derive(password: &str, salt: &[u8], params: Params) -> AppResult<[u8; HASH_LEN]> {
    let mut out = [0u8; HASH_LEN];
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(password.as_bytes(), salt, &mut out)
        .map_err(|e| AppError::Internal(format!("password hashing failed: {e}")))?;
    Ok(out)
}

pub fn random_bytes<const N: usize>() -> AppResult<[u8; N]> {
    let mut buf = [0u8; N];
    getrandom::fill(&mut buf).map_err(|e| AppError::Internal(format!("no OS randomness: {e}")))?;
    Ok(buf)
}

/// `argon2id$v=19$m=…,t=…,p=…$<salt>$<hash>` (PHC-style, unpadded base64).
pub fn hash(password: &str) -> AppResult<String> {
    validate_new(password)?;
    let salt: [u8; SALT_LEN] = random_bytes()?;
    let p = params()?;
    let h = derive(password, &salt, p.clone())?;
    Ok(format!(
        "argon2id$v=19$m={},t={},p={}${}${}",
        p.m_cost(),
        p.t_cost(),
        p.p_cost(),
        B64.encode(salt),
        B64.encode(h)
    ))
}

/// True when `password` matches `stored`. Malformed records never match.
pub fn verify(stored: &str, password: &str) -> bool {
    let parts: Vec<&str> = stored.split('$').collect();
    let [alg, version, costs, salt, expected] = parts.as_slice() else {
        return false;
    };
    if *alg != "argon2id" || *version != "v=19" {
        return false;
    }
    let mut m = None;
    let mut t = None;
    let mut p = None;
    for kv in costs.split(',') {
        match kv.split_once('=') {
            Some(("m", v)) => m = v.parse().ok(),
            Some(("t", v)) => t = v.parse().ok(),
            Some(("p", v)) => p = v.parse().ok(),
            _ => return false,
        }
    }
    let (Some(m), Some(t), Some(p)) = (m, t, p) else {
        return false;
    };
    let (Ok(salt), Ok(expected)) = (B64.decode(salt), B64.decode(expected)) else {
        return false;
    };
    let Ok(params) = Params::new(m, t, p, Some(expected.len())) else {
        return false;
    };
    let mut out = vec![0u8; expected.len()];
    if Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(password.as_bytes(), &salt, &mut out)
        .is_err()
    {
        return false;
    }
    constant_time_eq(&out, &expected)
}

pub(crate) fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Wrong attempts make the next attempt wait: 2 s, 4 s, 8 s … up to 5 minutes.
#[derive(Debug, Default)]
pub struct Limiter {
    failures: u32,
    wait_until: Option<Instant>,
}

impl Limiter {
    pub fn check(&self, now: Instant) -> AppResult<()> {
        match self.wait_until {
            Some(until) if until > now => {
                let secs = (until - now).as_secs().max(1);
                Err(AppError::Limit(format!(
                    "Too many wrong passwords. Try again in {secs} second{}.",
                    if secs == 1 { "" } else { "s" }
                )))
            }
            _ => Ok(()),
        }
    }

    pub fn failed(&mut self, now: Instant) {
        self.failures = self.failures.saturating_add(1);
        if self.failures > FREE_ATTEMPTS {
            let exp = (self.failures - FREE_ATTEMPTS).min(16);
            let wait = Duration::from_secs(1u64 << exp).min(MAX_WAIT);
            self.wait_until = Some(now + wait);
        }
    }

    pub fn succeeded(&mut self) {
        *self = Self::default();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_verify_and_are_salted() {
        let a = hash("correct horse").unwrap();
        let b = hash("correct horse").unwrap();
        assert_ne!(a, b, "salted");
        assert!(a.starts_with("argon2id$v=19$m=19456,t=2,p=1$"));
        assert!(!a.contains("correct"));
        assert!(verify(&a, "correct horse"));
        assert!(!verify(&a, "correct horsE"));
        assert!(!verify(&a, ""));
    }

    #[test]
    fn malformed_records_never_match() {
        for bad in [
            "",
            "plain",
            "argon2i$v=19$m=8,t=1,p=1$AAAA$AAAA",
            "argon2id$v=19$m=x$AA$AA",
        ] {
            assert!(!verify(bad, "anything"), "{bad}");
        }
    }

    #[test]
    fn length_rules() {
        assert!(hash("12345").is_err());
        assert!(hash(&"x".repeat(129)).is_err());
        assert!(hash("123456").is_ok());
    }

    #[test]
    fn limiter_backs_off_after_free_attempts() {
        let t0 = Instant::now();
        let mut l = Limiter::default();
        for _ in 0..FREE_ATTEMPTS {
            l.failed(t0);
            assert!(l.check(t0).is_ok());
        }
        l.failed(t0);
        let err = l.check(t0).unwrap_err().to_string();
        assert!(err.contains("Try again in 2 seconds"), "{err}");
        assert!(l.check(t0 + Duration::from_secs(2)).is_ok());
        l.failed(t0);
        assert!(l.check(t0 + Duration::from_secs(3)).is_err());
        for _ in 0..40 {
            l.failed(t0);
        }
        assert!(l.check(t0 + MAX_WAIT).is_ok(), "capped at 5 minutes");
        l.succeeded();
        assert!(l.check(t0).is_ok());
    }
}
