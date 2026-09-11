# JARVIS Bridge desktop app

This Windows desktop launcher wraps the existing bridge agent with a first-run
pairing form, connection status, command window, and a **Start with Windows**
switch.

## Development

```powershell
npm install
npm start
```

The app uses the bridge files in `../agent` while running from the repository.

## Build a Windows installer

```powershell
npm run dist
```

The installer bundles the bridge under the app's resources. The device token
continues to live in `%USERPROFILE%\.jarvis-bridge\config.json`, encrypted with
the bridge passphrase. If you choose to remember the passphrase, the desktop
app stores it with Windows DPAPI through Electron's `safeStorage`; it is never
written as plain text.
