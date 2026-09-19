# TeamOS Desktop

TeamOS in a desktop window (Tauri v2). The window loads TeamOS from the instance
itself rather than bundling a copy of the web app, so the desktop is never a
version behind the server — deploying the server updates the desktop too.

What the shell adds is what a browser tab cannot do:

- **Signing in through the system browser**, the way Figma and Canva do.
- **OS notifications** when a notification arrives while the window is in the
  background.
- **Closing hides to the tray** instead of quitting, so notifications keep
  arriving. "Quit TeamOS" in the tray menu is the way out.
- **Starting with the computer**, on by default and toggled from the tray.

Instance: `https://teamos.sentosh.com`, fixed at build time. The app offers no
way to point itself at another server; `TEAMOS_INSTANCE_URL` overrides it for a
development run only.

## Signing in

The app never asks for a password. Sign-in is a round trip through the browser
you already use, which is where passwords, passkeys and SSO sessions live:

1. The app generates a random `state` and opens
   `<instance>/desktop?state=…` in the default browser.
2. You sign in there normally, with every method the instance offers.
3. The page mints a single-use token and redirects to
   `teamos://auth/callback?token=…&state=…`.
4. The app checks that `state` is the one it issued — a callback it did not ask
   for is dropped — and loads `<instance>/desktop/callback#token=…` in its
   window.
5. That page redeems the token, which sets the normal session cookie in the
   window. From there the desktop is an ordinary signed-in TeamOS client.

The token is single-use and expires after two minutes. It carries the browser's
session rather than creating a second one, so **signing out in either place
signs out both**.

`teamos://` is registered when the app is installed. A `tauri dev` run registers
it at startup instead, because nothing was installed.

## Notifications

The web app already keeps a user WebSocket open for `NOTIFICATION_CREATED`.
Inside the shell it asks the window whether it is actually in front of the user
(visible, not minimised, focused) and raises an OS notification when it is not.
In a normal browser the same code path uses the Notification API.

Clicking the toast is not wired to open anything yet — Tauri's notification
plugin has no Rust-side activation callback. The unread count reaches the
taskbar badge where the platform has one, and the tray tooltip everywhere else.

## What the instance is allowed to do

The window loads a remote origin, and Tauri refuses IPC from a remote origin
unless a capability names it. `src-tauri/capabilities/instance.json` grants the
shipped instances exactly four commands:

| Command | What it does |
| --- | --- |
| `desktop_start_login` | Opens the browser on the sign-in handoff page |
| `desktop_notify` | Raises an OS notification |
| `desktop_set_badge` | Sets the unread count on the badge and tray tooltip |
| `desktop_is_foreground` | Answers whether the window is in front of the user |

That is the whole IPC surface — there is no command to read or change which
server the app points at, from a page or from the tray. Everything else the app
does (the tray, hiding on close, start at login) is Rust only and reachable from
no page at all.

A non-default `TEAMOS_INSTANCE_URL` is granted the same four at runtime, so a
development host works without editing this file.

## Building

Requirements: Rust (stable), and on Windows the MSVC build tools plus WebView2
(already part of Windows 11). The Tauri CLI runs through `npx`. Like
[`apps/agent`](../agent/README.md), this folder has no `package.json` and stays
outside the pnpm workspace on purpose.

```bash
cd apps/desktop
npx @tauri-apps/cli@2 dev      # run with a console for logs
npx @tauri-apps/cli@2 build    # release bundles
cd src-tauri && cargo test     # unit tests
```

Bundles land in `src-tauri/target/release/bundle/`:

- Windows: `nsis/TeamOS_<version>_x64-setup.exe` and `msi/TeamOS_<version>_x64_en-US.msi`
- macOS: `macos/TeamOS.app` and `dmg/TeamOS_<version>_x64.dmg`

Bump `version` in `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`
together before cutting a build.

### Pointing a build at a different server

An installed app is fixed to its build-time instance. For a development run,
`TEAMOS_INSTANCE_URL` overrides it without touching the saved config:

```bash
TEAMOS_INSTANCE_URL=http://localhost:5173 npx @tauri-apps/cli@2 dev
```

`localhost:5173` and `127.0.0.1:5173` are already in the shipped capability, so
IPC works against a local `pnpm dev` without any extra setup.

`TEAMOS_DESKTOP_DATA_DIR` moves the config so a development run does not disturb
an installed app.

To ship a build for a different server, edit `DEFAULT_INSTANCE_URL` in
`src-tauri/src/config.rs` and add the origin to `capabilities/instance.json`.

## Distributing to the team

Builds are made locally and uploaded to R2; there is no CI in this repository.

```bash
cd apps/desktop
npx @tauri-apps/cli@2 build

# Upload the installer under a versioned key, then update a stable "latest" key.
rclone copy src-tauri/target/release/bundle/nsis/TeamOS_0.1.0_x64-setup.exe \
  r2:teamos-downloads/desktop/0.1.0/
rclone copyto src-tauri/target/release/bundle/nsis/TeamOS_0.1.0_x64-setup.exe \
  r2:teamos-downloads/desktop/latest/TeamOS-setup.exe
```

Keep the versioned copy: a bad build is then one link away from being rolled
back, and people who already downloaded it have something to compare against.

There is no auto-updater. Telling people a new version exists is manual for now;
`tauri-plugin-updater` against a JSON manifest in the same bucket is the natural
next step.

## Code signing

Not set up. Unsigned builds warn on first run:

- **Windows**: SmartScreen shows "Windows protected your PC" → More info → Run
  anyway. An EV or OV certificate in `tauri.conf.json` under
  `bundle.windows.certificateThumbprint` removes it.
- **macOS**: right-click → Open the first time. Proper removal needs an Apple
  Developer ID and notarization.

## Icons

Generated from the web app's `apps/web/public/favicon.svg`, so the desktop
window, taskbar, tray, installer and the browser tab all show one mark:

```bash
npx @tauri-apps/cli@2 icon ../web/public/favicon.svg -o src-tauri/icons
rm -rf src-tauri/icons/android src-tauri/icons/ios        src-tauri/icons/Square*Logo.png src-tauri/icons/StoreLogo.png
```

The mobile and Microsoft Store sizes are pruned because this app ships for
Windows and macOS only.

## Known limitations

- Clicking an OS notification does not open the thing it announced.
- No auto-updater.
- Linux bundles are not built or tested.
- The desktop session and the browser session are the same session; signing out
  in one signs out the other.

## Relationship to `apps/agent`

[`apps/agent`](../agent/README.md) is a separate, optional app that reports
activity and app usage to a workspace. It has its own tray icon, its own pairing
and its own install. This app does not track anything; it is TeamOS in a window.
Someone whose workspace uses activity tracking runs both.
