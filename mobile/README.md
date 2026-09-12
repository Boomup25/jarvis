# JARVIS iOS client

This is the native client: secure login, the JARVIS dashboard, chat, library,
memory, week view, bridge voice status, and playback of the same JARVIS audio
returned by `/api/speak`.

The project targets Expo SDK 57. Microphone transcription uses the native
`expo-speech-recognition` module, so voice input requires a development build;
it is not available in the standard Expo Go client.

```bash
cd mobile
npm install
copy .env.example .env
# Set EXPO_PUBLIC_JARVIS_URL in .env, then:
npm start
```

For text and the rest of the UI, `npm start` is enough. To test the microphone,
install a development build and start Metro for that build:

```bash
npx eas build --profile development --platform ios
npx expo start --dev-client
```

The app stores the mobile session token in iOS Keychain via `expo-secure-store`.

The app calls `/api/speak` after each reply. If Voice → Synthesised by is
**Machine** or **Auto** and the Windows bridge is connected, the server asks the
bridge to render the reply with the local LuxTTS reference voice. The returned
audio is played on the iPhone. **Auto** can use the configured cloud voice when
the computer is offline; **Machine** intentionally fails instead.
