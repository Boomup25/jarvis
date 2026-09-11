# JARVIS iOS client

This is the first native client slice: secure login, chat, bridge voice status,
and playback of the same JARVIS audio returned by `/api/speak`.

```bash
cd mobile
npm install
copy .env.example .env
# Set EXPO_PUBLIC_JARVIS_URL in .env, then:
npm start
```

Use Expo Go for an early device test, or use an EAS/Xcode iOS build for a
standalone app. The app stores the mobile session token in iOS Keychain via
`expo-secure-store`.

The app calls `/api/speak` after each reply. If Voice → Synthesised by is
**Machine** or **Auto** and the Windows bridge is connected, the server asks the
bridge to render the reply with the local LuxTTS reference voice. The returned
audio is played on the iPhone. **Auto** can use the configured cloud voice when
the computer is offline; **Machine** intentionally fails instead.
