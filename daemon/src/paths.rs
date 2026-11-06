//! Runtime locations of the privileged service.
//!
//! Only the layout is detected from the environment. Every path inside a
//! layout is fixed, so no environment variable can redirect the socket,
//! journal or tunnel configuration.

use std::ffi::OsStr;
use std::fs::{self, DirBuilder, OpenOptions};
use std::io::{self, Write};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

const SNAP_NAME: &str = "k1vpn";
const SNAP_COMMON: &str = "/var/snap/k1vpn/common";
const SNAP_MOUNT_PREFIX: &str = "/snap/k1vpn/";
const BOOT_ID_SOURCE: &str = "/proc/sys/kernel/random/boot_id";
const SYSTEM_PATH: &str = "/usr/sbin:/usr/bin:/sbin:/bin";

static PATHS: OnceLock<Paths> = OnceLock::new();

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Layout {
    /// Development package: systemd creates the directories.
    System,
    /// Strict Snap: the service creates the directories itself.
    Snap,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Paths {
    pub layout: Layout,
    pub runtime_dir: PathBuf,
    pub state_dir: PathBuf,
    /// Root below which networking tools are resolved: `/` for the system
    /// layout, the mounted Snap revision for the Snap layout.
    tools_root: PathBuf,
}

impl Paths {
    fn system() -> Self {
        Self {
            layout: Layout::System,
            runtime_dir: PathBuf::from("/run/k1vpn"),
            state_dir: PathBuf::from("/var/lib/k1vpn"),
            tools_root: PathBuf::from("/"),
        }
    }

    fn snap(tools_root: PathBuf) -> Self {
        Self {
            layout: Layout::Snap,
            runtime_dir: Path::new(SNAP_COMMON).join("run"),
            state_dir: Path::new(SNAP_COMMON).join("state"),
            tools_root,
        }
    }

    pub fn socket(&self) -> PathBuf {
        self.runtime_dir.join("k1vpnd.sock")
    }

    /// Written by releases that configured the tunnel through wg-quick; it
    /// held the private key. Startup removes any copy left behind.
    pub fn tunnel_config(&self) -> PathBuf {
        self.runtime_dir.join("k1vpn0.conf")
    }

    pub fn journal(&self) -> PathBuf {
        self.state_dir.join("recovery.json")
    }

    /// Written by the Snap's pre-refresh hook just before snapd stops the
    /// service for a refresh.
    fn refresh_marker(&self) -> PathBuf {
        self.runtime_dir.join("refresh-pending")
    }

    /// A marker older than this belongs to a refresh that never stopped the
    /// service, and must not keep a tunnel up during a later removal.
    pub fn refresh_pending(&self) -> bool {
        const FRESH: std::time::Duration = std::time::Duration::from_secs(600);
        fs::symlink_metadata(self.refresh_marker())
            .ok()
            .filter(|metadata| metadata.is_file())
            .and_then(|metadata| metadata.modified().ok())
            .and_then(|modified| modified.elapsed().ok())
            .is_some_and(|age| age < FRESH)
    }

    /// The new revision has started; the marker has served its purpose.
    pub fn clear_refresh_marker(&self) {
        let _ = fs::remove_file(self.refresh_marker());
    }

    fn boot_marker(&self) -> PathBuf {
        self.runtime_dir.join("boot-id")
    }

    pub fn tool(&self, relative: &str) -> PathBuf {
        match self.layout {
            Layout::System => self.tools_root.join(relative),
            Layout::Snap => self.tools_root.join("libexec/k1vpn-tools").join(
                Path::new(relative)
                    .file_name()
                    .expect("fixed networking tool name"),
            ),
        }
    }

    /// `PATH` for child processes. In a Snap, `/usr/bin` is the base snap,
    /// never the host.
    pub fn child_path(&self) -> String {
        match self.layout {
            Layout::System => SYSTEM_PATH.to_owned(),
            Layout::Snap => {
                let root = self.tools_root.display();
                format!(
                    "{root}/libexec/k1vpn-tools:{root}/usr/sbin:{root}/usr/bin:{root}/sbin:{root}/bin:{SYSTEM_PATH}"
                )
            }
        }
    }

    /// Staged networking tools need their own libraries after env_clear().
    /// Derive this only from the validated Snap mount, never the caller's env.
    pub fn child_library_path(&self) -> Option<String> {
        if self.layout != Layout::Snap {
            return None;
        }
        let root = self.tools_root.display();
        let triplet = match std::env::consts::ARCH {
            "aarch64" => "aarch64-linux-gnu",
            _ => "x86_64-linux-gnu",
        };
        Some(format!(
            "{root}/usr/lib/{triplet}:{root}/lib/{triplet}:{root}/usr/lib:{root}/lib:{root}/gnome-platform/usr/lib/{triplet}:{root}/gnome-platform/lib/{triplet}"
        ))
    }
}

fn detect(
    snap_name: Option<&OsStr>,
    instance_name: Option<&OsStr>,
    executable: &Path,
) -> io::Result<Paths> {
    let Some(name) = snap_name else {
        return Ok(Paths::system());
    };
    // Parallel instances would share the fixed paths of the primary one.
    if name != SNAP_NAME || instance_name.is_some_and(|instance| instance != SNAP_NAME) {
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "the service runs only as the k1vpn snap",
        ));
    }
    // The kernel reports the executable as $SNAP/bin/k1vpnd.
    let root = executable
        .parent()
        .and_then(Path::parent)
        .filter(|root| {
            root.starts_with(SNAP_MOUNT_PREFIX)
                && root.components().count() == 4
                && executable.ends_with("bin/k1vpnd")
        })
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                "the service executable is outside the snap mount",
            )
        })?;
    Ok(Paths::snap(root.to_path_buf()))
}

pub fn init() -> io::Result<&'static Paths> {
    let paths = detect(
        std::env::var_os("SNAP_NAME").as_deref(),
        std::env::var_os("SNAP_INSTANCE_NAME").as_deref(),
        &std::env::current_exe()?,
    )?;
    Ok(PATHS.get_or_init(|| paths))
}

pub fn get() -> &'static Paths {
    PATHS
        .get()
        .expect("paths are initialized at service startup")
}

/// Checks that `path` is a real directory owned by this process's user, and
/// in the Snap layout creates it and enforces `mode`.
fn ensure_directory(path: &Path, mode: u32, create: bool) -> io::Result<()> {
    if create {
        match DirBuilder::new().mode(mode).create(path) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error),
        }
    }
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.file_type().is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "runtime location is not a directory",
        ));
    }
    if metadata.uid() != nix::unistd::geteuid().as_raw() {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "runtime directory has an unexpected owner",
        ));
    }
    if create && metadata.mode() & 0o7777 != mode {
        fs::set_permissions(path, fs::Permissions::from_mode(mode))?;
    }
    Ok(())
}

/// Prepares the directories and discards runtime files from an earlier boot.
pub fn prepare(paths: &Paths) -> io::Result<()> {
    let create = paths.layout == Layout::Snap;
    if create {
        ensure_directory(Path::new(SNAP_COMMON), 0o755, false)
            .map_err(|error| context(&SNAP_COMMON, error))?;
    }
    // The socket must be reachable by unprivileged users; authorization is
    // enforced per request, not by directory permissions.
    ensure_directory(&paths.runtime_dir, 0o755, create)
        .map_err(|error| context(&paths.runtime_dir.display(), error))?;
    ensure_directory(&paths.state_dir, 0o700, create)
        .map_err(|error| context(&paths.state_dir.display(), error))?;
    let boot_id =
        fs::read_to_string(BOOT_ID_SOURCE).map_err(|error| context(&BOOT_ID_SOURCE, error))?;
    discard_previous_boot(paths, boot_id.trim())
        .map_err(|error| context(&paths.runtime_dir.display(), error))
}

/// Startup errors go only to the journal, so naming the location is safe.
fn context(location: &dyn std::fmt::Display, error: io::Error) -> io::Error {
    io::Error::new(error.kind(), format!("{location}: {error}"))
}

/// `$SNAP_COMMON` survives a reboot, unlike `/run`. A tunnel configuration
/// written during an earlier boot no longer has an interface, so it is
/// removed and recovery cleanup stays idempotent. The journal is kept: it
/// still requires recovery of routes and firewall state.
fn discard_previous_boot(paths: &Paths, boot_id: &str) -> io::Result<()> {
    let marker = paths.boot_marker();
    let previous = match fs::read_to_string(&marker) {
        Ok(value) => Some(value),
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(error) => return Err(error),
    };
    if previous.as_deref().map(str::trim) == Some(boot_id) {
        return Ok(());
    }
    let config = paths.tunnel_config();
    match fs::symlink_metadata(&config) {
        Ok(metadata) if metadata.file_type().is_symlink() || metadata.is_file() => {
            fs::remove_file(&config)?
        }
        Ok(_) => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "unexpected entry at the tunnel configuration path",
            ));
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    let temporary = paths.runtime_dir.join("boot-id.tmp");
    let _ = fs::remove_file(&temporary);
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o644)
        .open(&temporary)?;
    file.write_all(format!("{boot_id}\n").as_bytes())?;
    file.sync_all()?;
    fs::rename(&temporary, &marker)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snap_exe() -> PathBuf {
        PathBuf::from("/snap/k1vpn/42/bin/k1vpnd")
    }

    #[test]
    fn uses_fixed_system_paths_outside_a_snap() {
        let paths = detect(None, None, Path::new("/opt/K1VPN/resources/daemon/k1vpnd")).unwrap();
        assert_eq!(paths.layout, Layout::System);
        assert_eq!(paths.socket(), Path::new("/run/k1vpn/k1vpnd.sock"));
        assert_eq!(paths.journal(), Path::new("/var/lib/k1vpn/recovery.json"));
        assert_eq!(paths.tool("usr/bin/wg"), Path::new("/usr/bin/wg"));
        assert_eq!(paths.child_path(), SYSTEM_PATH);
        assert!(paths.child_library_path().is_none());
    }

    #[test]
    fn uses_fixed_snap_paths_and_tools_from_the_mounted_revision() {
        let name = OsStr::new("k1vpn");
        let paths = detect(Some(name), Some(name), &snap_exe()).unwrap();
        assert_eq!(paths.layout, Layout::Snap);
        assert_eq!(
            paths.socket(),
            Path::new("/var/snap/k1vpn/common/run/k1vpnd.sock")
        );
        assert_eq!(
            paths.tunnel_config(),
            Path::new("/var/snap/k1vpn/common/run/k1vpn0.conf")
        );
        assert_eq!(
            paths.journal(),
            Path::new("/var/snap/k1vpn/common/state/recovery.json")
        );
        assert_eq!(
            paths.tool("usr/bin/wg"),
            Path::new("/snap/k1vpn/42/libexec/k1vpn-tools/wg")
        );
        assert!(
            paths
                .child_path()
                .starts_with("/snap/k1vpn/42/libexec/k1vpn-tools:")
        );
        assert!(paths.child_path().ends_with(SYSTEM_PATH));
        assert!(
            paths
                .child_library_path()
                .unwrap()
                .split(':')
                .all(|path| path.starts_with("/snap/k1vpn/42/"))
        );
    }

    #[test]
    fn rejects_other_snaps_instances_and_foreign_executables() {
        let name = OsStr::new("k1vpn");
        assert!(detect(Some(OsStr::new("other")), None, &snap_exe()).is_err());
        assert!(detect(Some(name), Some(OsStr::new("k1vpn_dev")), &snap_exe()).is_err());
        for executable in [
            "/usr/bin/k1vpnd",
            "/snap/k1vpn/42/k1vpnd",
            "/snap/k1vpn/42/bin/other",
            "/snap/k1vpn-evil/42/bin/k1vpnd",
            "/snap/k1vpn/42/x/bin/k1vpnd",
        ] {
            assert!(
                detect(Some(name), None, Path::new(executable)).is_err(),
                "{executable}"
            );
        }
    }

    fn scratch_paths(label: &str) -> Paths {
        let root =
            std::env::temp_dir().join(format!("k1vpnd-paths-{label}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("run")).unwrap();
        Paths {
            layout: Layout::System,
            runtime_dir: root.join("run"),
            state_dir: root.join("state"),
            tools_root: PathBuf::from("/"),
        }
    }

    #[test]
    fn discards_a_tunnel_configuration_from_an_earlier_boot_only() {
        let paths = scratch_paths("boot");
        fs::write(paths.tunnel_config(), "stale").unwrap();
        discard_previous_boot(&paths, "boot-a").unwrap();
        assert!(!paths.tunnel_config().exists());

        fs::write(paths.tunnel_config(), "current").unwrap();
        discard_previous_boot(&paths, "boot-a").unwrap();
        assert!(paths.tunnel_config().exists());

        discard_previous_boot(&paths, "boot-b").unwrap();
        assert!(!paths.tunnel_config().exists());
        assert_eq!(fs::read_to_string(paths.boot_marker()).unwrap(), "boot-b\n");
        let _ = fs::remove_dir_all(paths.runtime_dir.parent().unwrap());
    }

    #[test]
    fn refuses_symlinked_runtime_directories() {
        let paths = scratch_paths("link");
        let link = paths.runtime_dir.parent().unwrap().join("linked");
        std::os::unix::fs::symlink(&paths.runtime_dir, &link).unwrap();
        assert!(ensure_directory(&link, 0o755, true).is_err());
        ensure_directory(&paths.state_dir, 0o700, true).unwrap();
        let mode = fs::metadata(&paths.state_dir).unwrap().mode() & 0o7777;
        assert_eq!(mode, 0o700);
        let _ = fs::remove_dir_all(paths.runtime_dir.parent().unwrap());
    }
}
