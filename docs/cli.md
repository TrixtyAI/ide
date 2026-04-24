# Trixty IDE CLI — `tide`

Trixty IDE ships with a small terminal launcher called `tide` that opens a
folder as a workspace, the same way VS Code's `code` command does.

```shell
# Open the current directory
tide .

# Open an absolute path (Windows, macOS, Linux)
tide C:\test
tide /home/me/repo
tide /Users/me/Documents/project

# Open a relative path
tide ../some-project
```

Under the hood, `tide` locates the installed `TrixtyIDE` binary and spawns
it with the `--path` argument. The main binary validates the path (it must
exist and be a directory), canonicalises it, and boots straight into that
workspace.

If the path is invalid — does not exist, or points at a file — the IDE
still launches, but falls back to its normal "no folder open" cold start
rather than crashing. A warning is written to the log.

You can also invoke the main binary directly without the launcher:

```shell
TrixtyIDE --path C:\test
TrixtyIDE --path=./relative/path
TrixtyIDE .                       # positional form also works
```

## Installing `tide` on your `PATH`

`tide` is built alongside the main `TrixtyIDE` binary and placed in the
same install directory. Adding that directory (or a symlink to `tide`) to
your `PATH` is enough.

A dedicated installer integration for each platform (auto-register
`tide` on PATH during setup, Start Menu / Dock shortcuts, `.desktop`
file for Linux) is planned as a follow-up. For now, set it up manually
once — the launcher itself needs no configuration.

### Windows

The installer places `TrixtyIDE.exe` and `tide.exe` in
`C:\Program Files\TrixtyIDE\` (or `%LOCALAPPDATA%\Programs\TrixtyIDE\`
for a user-scope install). Add that directory to your `PATH`:

1. Press **Win** and search for "Edit the system environment variables".
2. Click **Environment Variables…**.
3. Under **User variables**, select `Path` → **Edit** → **New** and paste
   the install directory.
4. Click **OK** on all dialogs, then open a new terminal.

Verify with:

```powershell
tide --help
# or
where.exe tide
```

Alternatively, from PowerShell (user-scope, persistent):

```powershell
$install = "$env:LOCALAPPDATA\Programs\TrixtyIDE"   # adjust if different
[Environment]::SetEnvironmentVariable(
    "Path",
    "$([Environment]::GetEnvironmentVariable('Path','User'));$install",
    "User"
)
```

### macOS

The installer drops `TrixtyIDE.app` into `/Applications/`. Symlink the
CLI launcher into a directory that's already on your `PATH`:

```shell
sudo ln -s /Applications/TrixtyIDE.app/Contents/MacOS/tide /usr/local/bin/tide
```

Or — preferred when `/usr/local/bin` is write-protected on newer macOS —
add `~/.local/bin` and symlink there:

```shell
mkdir -p ~/.local/bin
ln -s /Applications/TrixtyIDE.app/Contents/MacOS/tide ~/.local/bin/tide
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

### Linux

For `.deb` / `.rpm` installs that land in `/usr/bin`, `tide` should
already be on your `PATH` with no extra work. Verify:

```shell
which tide
tide --help
```

For AppImage or a portable extract, symlink into `~/.local/bin` (most
distributions put this on `PATH` by default in recent shell profiles):

```shell
mkdir -p ~/.local/bin
ln -s /opt/TrixtyIDE/tide ~/.local/bin/tide
```

If `~/.local/bin` is not on your `PATH`, add this to `~/.bashrc` /
`~/.zshrc`:

```shell
export PATH="$HOME/.local/bin:$PATH"
```

## Overriding the binary path

If `tide` can't find `TrixtyIDE` through the search strategy above —
maybe you run a custom build, or the binary lives under a non-standard
name — set `TRIXTY_IDE_PATH` to point at it:

```shell
# Unix
export TRIXTY_IDE_PATH=/opt/my-builds/TrixtyIDE
tide .

# Windows (PowerShell)
$env:TRIXTY_IDE_PATH = "D:\dev\TrixtyIDE\target\release\TrixtyIDE.exe"
tide .
```

This variable takes priority over every other discovery step, so it's
also the easiest knob for a development workflow where you want `tide`
to invoke `cargo run` output instead of the installed binary.

## Troubleshooting

### `tide: could not find the TrixtyIDE binary`

The launcher walks a fixed set of candidates:

1. `$TRIXTY_IDE_PATH` (if set).
2. The sibling directory of `tide` itself.
3. Every entry in `$PATH`.
4. A platform-specific list of default install locations.

The error message lists the first ten paths it tried. Either install
Trixty IDE, or set `TRIXTY_IDE_PATH` to its full path.

### The IDE opens, but the folder I asked for isn't loaded

Check the log file:

- Windows: `%APPDATA%\trixty.ide\logs\trixty.log`
- macOS: `~/Library/Logs/trixty.ide/trixty.log`
- Linux: `~/.local/share/trixty.ide/logs/trixty.log`

If the argument failed validation, the log will contain a
`Ignoring invalid CLI workspace argument …` line explaining why (path
does not exist, path is not a directory, etc.).
