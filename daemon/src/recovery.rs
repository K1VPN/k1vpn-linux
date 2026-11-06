#![cfg_attr(
    not(test),
    allow(
        dead_code,
        reason = "journal mutation is used by the pending privileged tunnel lifecycle"
    )
)]

use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecoveryRecord {
    pub version: u8,
    pub operation_id: String,
    pub server_id: String,
    pub phase: RecoveryPhase,
    /// What a restarted service needs to adopt the live tunnel after a
    /// refresh. Journals written before these fields existed lack them.
    #[serde(default)]
    pub kill_switch: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verify_target: Option<std::net::IpAddr>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecoveryPhase {
    Preparing,
    TunnelCreated,
    RoutesApplied,
    DnsApplied,
    FirewallApplied,
    Disconnecting,
}

pub struct RecoveryJournal {
    path: PathBuf,
}

impl RecoveryJournal {
    #[cfg(unix)]
    pub fn production() -> Self {
        Self::new(crate::paths::get().journal())
    }

    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    /// File presence alone requires recovery. A corrupt journal is not treated
    /// as evidence that privileged network changes are absent.
    pub fn required(&self) -> io::Result<bool> {
        match fs::symlink_metadata(&self.path) {
            Ok(_) => Ok(true),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(error),
        }
    }

    pub fn read(&self) -> io::Result<Option<RecoveryRecord>> {
        let raw = match fs::read(&self.path) {
            Ok(raw) => raw,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error),
        };
        let record: RecoveryRecord = serde_json::from_slice(&raw)
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "invalid recovery journal"))?;
        validate_record(&record)?;
        Ok(Some(record))
    }

    pub fn write(&self, record: &RecoveryRecord) -> io::Result<()> {
        validate_record(record)?;
        let parent = self
            .path
            .parent()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "journal has no parent"))?;
        fs::create_dir_all(parent)?;
        let temporary = temporary_path(&self.path);
        let result = (|| {
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            options.mode(0o600);
            let mut file = options.open(&temporary)?;
            serde_json::to_writer(&mut file, record)?;
            file.write_all(b"\n")?;
            file.sync_all()?;
            fs::rename(&temporary, &self.path)?;
            sync_directory(parent)
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result
    }

    /// Invalid journal contents must not prevent cleanup of our fixed
    /// networking resources. Preserve the file until cleanup succeeds.
    pub fn begin_disconnect(&self) -> io::Result<()> {
        match self.read() {
            Ok(Some(mut record)) => {
                record.phase = RecoveryPhase::Disconnecting;
                self.write(&record)
            }
            Ok(None) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::InvalidData => {
                eprintln!("k1vpnd: recovering networking with an invalid journal");
                Ok(())
            }
            Err(error) => Err(error),
        }
    }

    pub fn clear(&self) -> io::Result<()> {
        match fs::remove_file(&self.path) {
            Ok(()) => {
                if let Some(parent) = self.path.parent() {
                    sync_directory(parent)?;
                }
                Ok(())
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error),
        }
    }
}

fn validate_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
}

fn validate_record(record: &RecoveryRecord) -> io::Result<()> {
    if record.version != 1
        || !validate_identifier(&record.operation_id)
        || !validate_identifier(&record.server_id)
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid recovery journal fields",
        ));
    }
    Ok(())
}

fn temporary_path(path: &Path) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    path.with_extension(format!("tmp-{}-{nonce}", std::process::id()))
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> io::Result<()> {
    fs::File::open(path)?.sync_all()
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "k1vpnd-recovery-{}-{}-{name}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    fn record() -> RecoveryRecord {
        RecoveryRecord {
            version: 1,
            operation_id: "operation-1".into(),
            server_id: "gr-1".into(),
            phase: RecoveryPhase::RoutesApplied,
            kill_switch: true,
            verify_target: Some("10.8.0.1".parse().unwrap()),
        }
    }

    #[test]
    fn journal_round_trips_and_clears_idempotently() {
        let directory = test_path("roundtrip");
        let journal = RecoveryJournal::new(directory.join("recovery.json"));
        assert!(!journal.required().unwrap());
        journal.write(&record()).unwrap();
        assert!(journal.required().unwrap());
        assert_eq!(journal.read().unwrap(), Some(record()));
        journal.clear().unwrap();
        journal.clear().unwrap();
        assert!(!journal.required().unwrap());
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn journals_without_adoption_fields_still_parse() {
        let directory = test_path("legacy");
        fs::create_dir_all(&directory).unwrap();
        let journal = RecoveryJournal::new(directory.join("recovery.json"));
        fs::write(
            &journal.path,
            br#"{"version":1,"operation_id":"op","server_id":"gr-1","phase":"tunnel_created"}"#,
        )
        .unwrap();
        let record = journal.read().unwrap().unwrap();
        assert!(!record.kill_switch);
        assert_eq!(record.verify_target, None);
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn corrupt_file_still_requires_recovery_and_is_not_trusted() {
        let directory = test_path("corrupt");
        fs::create_dir_all(&directory).unwrap();
        let journal = RecoveryJournal::new(directory.join("recovery.json"));
        fs::write(&journal.path, b"not-json").unwrap();
        assert!(journal.required().unwrap());
        assert_eq!(
            journal.read().unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
        journal.begin_disconnect().unwrap();
        // A failed cleanup must still be offered for recovery next time.
        assert!(journal.required().unwrap());
        assert_eq!(fs::read(&journal.path).unwrap(), b"not-json");
        journal.clear().unwrap();
        assert!(!journal.required().unwrap());
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn rejects_unsupported_versions_and_unbounded_identifiers() {
        let directory = test_path("invalid-fields");
        let journal = RecoveryJournal::new(directory.join("recovery.json"));
        let mut invalid = record();
        invalid.version = 2;
        assert_eq!(
            journal.write(&invalid).unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
        invalid.version = 1;
        invalid.server_id = "x".repeat(129);
        assert_eq!(
            journal.write(&invalid).unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
        let _ = fs::remove_dir_all(directory);
    }
}
