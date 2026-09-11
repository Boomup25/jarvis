import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import * as SecureStore from "expo-secure-store";
import { Buffer } from "buffer";
import { StatusBar } from "expo-status-bar";

type Message = { role: "user" | "assistant"; content: string };
type Session = { baseUrl: string; token: string; displayName: string };
const TOKEN_KEY = "jarvis.mobile.token";
const URL_KEY = "jarvis.mobile.url";
const NAME_KEY = "jarvis.mobile.name";
const DEFAULT_URL = process.env.EXPO_PUBLIC_JARVIS_URL ?? "";

function normalizeUrl(value: string) { return value.trim().replace(/\/+$/, ""); }
async function loadSession(): Promise<Session | null> {
  const [baseUrl, token, displayName] = await Promise.all([SecureStore.getItemAsync(URL_KEY), SecureStore.getItemAsync(TOKEN_KEY), SecureStore.getItemAsync(NAME_KEY)]);
  return baseUrl && token ? { baseUrl, token, displayName: displayName || "there" } : null;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [serverUrl, setServerUrl] = useState(DEFAULT_URL);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  useEffect(() => { void loadSession().then((saved) => { setSession(saved); setLoading(false); }); }, []);

  async function login() {
    const baseUrl = normalizeUrl(serverUrl);
    if (!baseUrl || !username || !password) { setLoginError("Enter the JARVIS address, username, and password."); return; }
    setLoading(true); setLoginError("");
    try {
      const response = await fetch(`${baseUrl}/api/auth/mobile`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.accessToken) throw new Error(data.error || `Login failed (${response.status})`);
      const next = { baseUrl, token: data.accessToken, displayName: data.user?.displayName || username };
      await Promise.all([SecureStore.setItemAsync(URL_KEY, baseUrl), SecureStore.setItemAsync(TOKEN_KEY, next.token), SecureStore.setItemAsync(NAME_KEY, next.displayName)]);
      setSession(next); setPassword("");
    } catch (error) { setLoginError(error instanceof Error ? error.message : "Could not reach JARVIS."); }
    finally { setLoading(false); }
  }
  async function logout() { await Promise.all([SecureStore.deleteItemAsync(TOKEN_KEY), SecureStore.deleteItemAsync(NAME_KEY)]); setSession(null); }
  if (loading && !session) return <View style={styles.center}><StatusBar style="light" /><ActivityIndicator color="#5edcff" /></View>;
  if (!session) return <LoginScreen serverUrl={serverUrl} setServerUrl={setServerUrl} username={username} setUsername={setUsername} password={password} setPassword={setPassword} error={loginError} loading={loading} onLogin={login} />;
  return <ChatScreen session={session} onLogout={logout} />;
}

function LoginScreen(props: { serverUrl: string; setServerUrl: (v: string) => void; username: string; setUsername: (v: string) => void; password: string; setPassword: (v: string) => void; error: string; loading: boolean; onLogin: () => void }) {
  return <SafeAreaView style={styles.safe}><StatusBar style="light" /><KeyboardAvoidingView style={styles.loginWrap} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <View style={styles.brandMark}><View style={styles.brandDot} /></View><Text style={styles.eyebrow}>J A R V I S</Text><Text style={styles.title}>Your personal intelligence.</Text><Text style={styles.muted}>Sign in to continue on this device.</Text>
    <View style={styles.card}><TextInput value={props.serverUrl} onChangeText={props.setServerUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://your-jarvis-domain" placeholderTextColor="#66738a" style={styles.input} /><TextInput value={props.username} onChangeText={props.setUsername} autoCapitalize="none" autoCorrect={false} placeholder="Username" placeholderTextColor="#66738a" style={styles.input} /><TextInput value={props.password} onChangeText={props.setPassword} secureTextEntry placeholder="Password" placeholderTextColor="#66738a" style={styles.input} onSubmitEditing={props.onLogin} />
      {!!props.error && <Text style={styles.error}>{props.error}</Text>}<Pressable style={styles.primary} onPress={props.onLogin} disabled={props.loading}>{props.loading ? <ActivityIndicator color="#031018" /> : <Text style={styles.primaryText}>Connect to JARVIS</Text>}</Pressable>
    </View>
  </KeyboardAvoidingView></SafeAreaView>;
}

function ChatScreen({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]); const [conversationId, setConversationId] = useState<string | undefined>(); const [input, setInput] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [voiceStatus, setVoiceStatus] = useState("Checking voice"); const [bridgeOnline, setBridgeOnline] = useState(false);
  const scrollRef = useRef<ScrollView>(null); const soundRef = useRef<AudioPlayer | null>(null);
  useEffect(() => { void setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false, interruptionMode: "doNotMix" }); void fetch(`${session.baseUrl}/api/settings`, { headers: { Authorization: `Bearer ${session.token}` } }).then((r) => r.json()).then((data) => { const machine = Boolean(data.speechMachine); setBridgeOnline(machine); setVoiceStatus(machine ? "LuxTTS · Windows bridge" : data.ttsConfigured ? "Cloud voice" : "Voice unavailable"); }).catch(() => setVoiceStatus("Voice status unavailable")); return () => { soundRef.current?.remove(); soundRef.current = null; }; }, [session]);

  async function speak(text: string) {
    const response = await fetch(`${session.baseUrl}/api/speak`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` }, body: JSON.stringify({ text }) });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Voice unavailable");
    const mime = response.headers.get("content-type") || "audio/mpeg"; const extension = mime.includes("wav") ? "wav" : "mp3"; const path = `${FileSystem.cacheDirectory}jarvis-reply.${extension}`;
    await FileSystem.writeAsStringAsync(path, Buffer.from(await response.arrayBuffer()).toString("base64"), { encoding: FileSystem.EncodingType.Base64 }); soundRef.current?.remove(); const player = createAudioPlayer({ uri: path }); soundRef.current = player; player.play();
  }

  async function send() {
    const text = input.trim(); if (!text || busy) return; setInput(""); setError(""); setMessages((current) => [...current, { role: "user", content: text }, { role: "assistant", content: "" }]); setBusy(true);
    try {
      const response = await fetch(`${session.baseUrl}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` }, body: JSON.stringify({ message: text, conversationId }) }); const raw = await response.text();
      if (!response.ok) { let detail = ""; try { detail = JSON.parse(raw).error || ""; } catch {} throw new Error(detail || `JARVIS returned ${response.status}`); }
      let answer = ""; for (const line of raw.split("\n")) { if (!line.trim()) continue; const event = JSON.parse(line) as { type?: string; delta?: string; conversationId?: string; message?: string }; if (event.type === "text") answer += event.delta || ""; if (event.type === "done") setConversationId(event.conversationId); if (event.type === "error") throw new Error(event.message || "JARVIS could not answer."); }
      setMessages((current) => current.map((message, index) => index === current.length - 1 ? { ...message, content: answer } : message)); if (answer) { try { await speak(answer); } catch (voiceError) { setVoiceStatus("Voice unavailable"); setError(voiceError instanceof Error ? voiceError.message : "Voice unavailable"); } }
    } catch (sendError) { setMessages((current) => current.slice(0, -1)); setError(sendError instanceof Error ? sendError.message : "Connection lost."); }
    finally { setBusy(false); setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50); }
  }

  return <SafeAreaView style={styles.safe}><StatusBar style="light" /><View style={styles.header}><View><Text style={styles.eyebrow}>J A R V I S</Text><Text style={styles.headerSub}>{bridgeOnline ? "ONLINE · BRIDGE READY" : "ONLINE"}</Text></View><Pressable onPress={onLogout}><Text style={styles.headerAction}>Sign out</Text></Pressable></View><View style={styles.voiceBar}><View style={[styles.statusDot, bridgeOnline && styles.statusDotLive]} /><Text style={styles.voiceText}>{voiceStatus}</Text></View><ScrollView ref={scrollRef} style={styles.messages} contentContainerStyle={styles.messagesContent} onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}>{messages.length === 0 && <View style={styles.empty}><Text style={styles.emptyOrb}>◉</Text><Text style={styles.emptyTitle}>Good to see you, {session.displayName}.</Text><Text style={styles.muted}>Ask JARVIS anything.</Text></View>}{messages.map((message, index) => <View key={`${index}-${message.role}`} style={[styles.bubble, message.role === "user" ? styles.userBubble : styles.assistantBubble]}><Text style={styles.bubbleLabel}>{message.role === "user" ? "YOU" : "JARVIS"}</Text><Text style={styles.bubbleText}>{message.content || (busy && index === messages.length - 1 ? "Thinking…" : "")}</Text></View>)}</ScrollView>{!!error && <Text style={styles.errorInline}>{error}</Text>}<View style={styles.composer}><TextInput value={input} onChangeText={setInput} editable={!busy} multiline placeholder="Ask JARVIS…" placeholderTextColor="#66738a" style={styles.composerInput} onSubmitEditing={send} /><Pressable onPress={send} disabled={busy || !input.trim()} style={[styles.send, (busy || !input.trim()) && styles.sendDisabled]}><Text style={styles.sendText}>↑</Text></Pressable></View></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#050910" }, center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#050910" }, loginWrap: { flex: 1, justifyContent: "center", padding: 24 }, brandMark: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: "#5edcff", alignItems: "center", justifyContent: "center", marginBottom: 22 }, brandDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: "#5edcff" }, eyebrow: { color: "#aec4d9", fontSize: 12, letterSpacing: 4, fontWeight: "700" }, title: { color: "#eff8ff", fontSize: 30, lineHeight: 36, fontWeight: "700", marginTop: 16 }, muted: { color: "#7d91a7", fontSize: 14, lineHeight: 21, marginTop: 8 }, card: { marginTop: 28, padding: 16, borderWidth: 1, borderColor: "#1c3044", borderRadius: 18, backgroundColor: "#0b1421", gap: 10 }, input: { color: "#eff8ff", borderWidth: 1, borderColor: "#20364c", borderRadius: 10, paddingHorizontal: 13, paddingVertical: 13, fontSize: 15, backgroundColor: "#07101b" }, primary: { marginTop: 4, borderRadius: 10, paddingVertical: 14, backgroundColor: "#5edcff", alignItems: "center" }, primaryText: { color: "#031018", fontSize: 14, fontWeight: "800", letterSpacing: .5 }, error: { color: "#ff9d9d", fontSize: 13, lineHeight: 18 }, header: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 13, borderBottomWidth: 1, borderBottomColor: "#162739", flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, headerSub: { color: "#55d9a1", fontSize: 9, letterSpacing: 1.3, marginTop: 4 }, headerAction: { color: "#7d91a7", fontSize: 12 }, voiceBar: { margin: 14, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 9, backgroundColor: "#0b1725", flexDirection: "row", alignItems: "center", gap: 8 }, statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#768398" }, statusDotLive: { backgroundColor: "#55d9a1" }, voiceText: { color: "#9bb0c4", fontSize: 12 }, messages: { flex: 1 }, messagesContent: { padding: 14, gap: 10, flexGrow: 1 }, empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingBottom: 80 }, emptyOrb: { color: "#5edcff", fontSize: 54, marginBottom: 14 }, emptyTitle: { color: "#e7f4ff", fontSize: 19, fontWeight: "600" }, bubble: { maxWidth: "90%", padding: 13, borderRadius: 14 }, userBubble: { alignSelf: "flex-end", backgroundColor: "#123c51", borderBottomRightRadius: 4 }, assistantBubble: { alignSelf: "flex-start", backgroundColor: "#0b1725", borderWidth: 1, borderColor: "#1b3043", borderBottomLeftRadius: 4 }, bubbleLabel: { color: "#75dcf7", fontSize: 9, letterSpacing: 1.5, fontWeight: "700", marginBottom: 5 }, bubbleText: { color: "#e7f4ff", fontSize: 15, lineHeight: 22 }, errorInline: { color: "#ff9d9d", fontSize: 12, paddingHorizontal: 18, paddingBottom: 6 }, composer: { margin: 12, marginTop: 0, padding: 7, borderWidth: 1, borderColor: "#20364c", borderRadius: 14, backgroundColor: "#0b1421", flexDirection: "row", alignItems: "flex-end" }, composerInput: { flex: 1, maxHeight: 110, color: "#eff8ff", paddingHorizontal: 9, paddingVertical: 8, fontSize: 15 }, send: { width: 38, height: 38, borderRadius: 10, backgroundColor: "#5edcff", alignItems: "center", justifyContent: "center" }, sendDisabled: { opacity: .35 }, sendText: { color: "#031018", fontSize: 22, fontWeight: "700" },
});
