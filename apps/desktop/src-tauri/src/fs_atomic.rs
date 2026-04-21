use std::io::Write;
use std::path::Path;

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
/// same volume (the atomicity guarantee is per-volume). A PID+timestamp
/// suffix keeps the temp name unique without pulling in a full tempfile
/// dependency, and the leading `.` keeps editors/file-watchers from
/// surfacing it to the user.
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

    let pid = std::process::id();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp_path = parent.join(format!(".{}.{}.{}.tmp", file_name, pid, nanos));

    // Write + fsync before rename so the data is actually on disk, not
    // merely in the OS page cache, before we commit.
    {
        let mut tmp = std::fs::File::create(&tmp_path)?;
        if let Err(e) = tmp.write_all(bytes).and_then(|_| tmp.sync_data()) {
            let _ = std::fs::remove_file(&tmp_path);
            return Err(e);
        }
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

#[cfg(test)]
mod tests {
    use super::write_atomic;
    use std::fs;

    fn tmp_dir() -> std::path::PathBuf {
        let base = std::env::temp_dir().join(format!(
            "trixty-fs-atomic-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
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
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .ends_with(".tmp")
            })
            .collect();
        assert!(
            leftovers.is_empty(),
            "expected no .tmp leftovers, found: {:?}",
            leftovers.iter().map(|e| e.file_name()).collect::<Vec<_>>()
        );
        fs::remove_dir_all(&dir).ok();
    }
}
