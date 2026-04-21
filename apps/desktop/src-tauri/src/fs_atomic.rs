use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

/// Write `bytes` to `path` atomically: stream to a sibling temp file, fsync
/// it, then rename over the destination.
///
/// On POSIX `rename` is atomic at the filesystem level. On Windows
/// `std::fs::rename` maps to `MoveFileEx` with
/// `MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH`, which performs the
/// replacement atomically on NTFS for same-volume targets. Either way, a
/// crash or power loss mid-write leaves the **original** file on disk
/// rather than a half-written truncation.
///
/// The temp file lives alongside the target so the rename stays on the
/// same volume (the atomicity guarantee is per-volume). The temp name
/// combines a process-wide atomic counter with PID and a nanosecond
/// timestamp, and is opened with `create_new(true)` so two concurrent
/// callers racing on the same target can never share the same file
/// (the loser retries with a new suffix rather than sharing-and-truncating
/// an existing temp).
///
/// When the destination already exists, its mode bits (on Unix) are copied
/// onto the temp file before the rename so an executable being atomically
/// replaced doesn't silently lose its `+x` bit. On Windows, ACLs inherited
/// from the destination's parent directory apply to the new file; that's
/// the same inheritance git/editors rely on for new files, so we don't
/// attempt manual ACL copy.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let parent = path.parent().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "atomic write target has no parent directory",
        )
    })?;

    if !parent.as_os_str().is_empty() && !parent.exists() {
        std::fs::create_dir_all(parent)?;
    }

    let file_name = path
        .file_name()
        .ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "atomic write target has no file name",
            )
        })?
        .to_string_lossy()
        .into_owned();

    // Open a fresh temp file with create_new(true). On collision (another
    // process / another thread inside the same process already minted the
    // same suffix) the call errors with AlreadyExists and we loop with a
    // new suffix rather than truncating a temp that someone else owns.
    let (tmp_path, mut tmp) = create_unique_temp(parent, &file_name)?;

    // Write + fsync before rename so the data is actually on disk, not
    // merely in the OS page cache, before we commit.
    if let Err(e) = tmp.write_all(bytes).and_then(|_| tmp.sync_data()) {
        drop(tmp);
        let _ = std::fs::remove_file(&tmp_path);
        return Err(e);
    }
    drop(tmp);

    // If the destination exists, carry over its permission bits to the
    // temp file so the rename doesn't silently change mode. On Windows
    // `set_permissions` only flips the read-only bit and ACLs are
    // inherited from the parent directory, so this is effectively a no-op
    // there; on Unix it preserves chmod state including +x.
    if let Ok(dest_meta) = std::fs::metadata(path) {
        let _ = std::fs::set_permissions(&tmp_path, dest_meta.permissions());
    }

    match std::fs::rename(&tmp_path, path) {
        Ok(()) => Ok(()),
        Err(e) => {
            // Best-effort cleanup so we don't leak `.tmp` files when the
            // rename itself fails (read-only target, cross-volume, etc.).
            let _ = std::fs::remove_file(&tmp_path);
            Err(e)
        }
    }
}

/// Generates unique temp paths even under SystemTime coarseness. Combines
/// PID, a nanosecond timestamp, and a process-wide monotonically
/// increasing counter so two callers that stat `SystemTime` inside the
/// same tick still get distinct suffixes. Retries with a fresh counter
/// value on `AlreadyExists` so a concurrent foreign file never wins the
/// race.
fn create_unique_temp(
    parent: &Path,
    file_name: &str,
) -> std::io::Result<(std::path::PathBuf, std::fs::File)> {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let pid = std::process::id();

    // Bound the retries so a permanently unwriteable directory surfaces as
    // an error instead of spinning forever.
    for _ in 0..32 {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
        let tmp_path = parent.join(format!(".{}.{}.{}.{}.tmp", file_name, pid, nanos, seq));

        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp_path)
        {
            Ok(file) => return Ok((tmp_path, file)),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }

    Err(std::io::Error::other(
        "could not allocate a unique temp file after 32 attempts",
    ))
}

#[cfg(test)]
mod tests {
    use super::write_atomic;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn tmp_dir() -> std::path::PathBuf {
        // Tests run in parallel by default. `SystemTime::now()` resolution
        // on some platforms (notably older Windows) is 15.6 ms, which is
        // coarse enough that two threads racing into this function share a
        // nanos value. Add a process-wide atomic counter plus the current
        // thread id so distinct test threads always get distinct paths.
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
        let tid = format!("{:?}", std::thread::current().id());
        let tid_safe: String = tid
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
            .collect();
        let base = std::env::temp_dir().join(format!(
            "trixty-fs-atomic-{}-{}-{}-{}",
            std::process::id(),
            tid_safe,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0),
            seq,
        ));
        fs::create_dir_all(&base).unwrap();
        base
    }

    #[test]
    fn writes_new_file() {
        let dir = tmp_dir();
        let target = dir.join("new.txt");
        write_atomic(&target, b"hello").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "hello");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn replaces_existing_file_contents() {
        let dir = tmp_dir();
        let target = dir.join("replace.txt");
        fs::write(&target, b"old payload").unwrap();
        write_atomic(&target, b"new payload").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "new payload");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn leaves_no_temp_files_behind_after_success() {
        let dir = tmp_dir();
        let target = dir.join("clean.txt");
        write_atomic(&target, b"payload").unwrap();
        let leftovers: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(
            leftovers.is_empty(),
            "expected no .tmp leftovers, found: {:?}",
            leftovers.iter().map(|e| e.file_name()).collect::<Vec<_>>()
        );
        fs::remove_dir_all(&dir).ok();
    }

    // Unix-only: the "executable bit lost on overwrite" regression the
    // review flagged is only observable through the Unix permission
    // model. On Windows `std::fs::Permissions` exposes only the
    // read-only bit and ACLs are inherited from the parent directory,
    // so there is no meaningful assertion beyond "the file still
    // exists", which the other tests already cover.
    #[cfg(unix)]
    #[test]
    fn preserves_unix_mode_bits_on_replace() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tmp_dir();
        let target = dir.join("perm.txt");
        fs::write(&target, b"original").unwrap();

        let mut perms = fs::metadata(&target).unwrap().permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&target, perms).unwrap();

        write_atomic(&target, b"replaced").unwrap();

        let new_perms = fs::metadata(&target).unwrap().permissions();
        assert_eq!(new_perms.mode() & 0o777, 0o755);

        fs::remove_dir_all(&dir).ok();
    }
}
