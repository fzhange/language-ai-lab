export type Language = 'en' | 'zh'

export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface TranslationRequest {
  text: string
  source_language: Language
  target_language: Language
  focus?: string
  follow_up?: string
  history?: ConversationMessage[]
}

export interface Settings {
  serviceUrl: string
  shortcutRegistered: boolean
}

export interface WakePayload {
  text?: string
  error?: string
}

export interface DesktopBridge {
  translate(request: TranslationRequest, requestId: string): Promise<string>
  onMentorText(callback: (payload: { requestId: string; text: string }) => void): () => void
  cancel(): Promise<void>
  readAloud(text: string, requestId: string): Promise<boolean>
  stopReading(): Promise<void>
  onSpeechState(callback: (payload: { requestId: string; speaking: boolean; error?: string }) => void): () => void
  getSettings(): Promise<Settings>
  saveSettings(settings: Pick<Settings, 'serviceUrl'>): Promise<Settings>
  checkConnection(): Promise<boolean>
  readClipboard(): Promise<string>
  writeClipboard(text: string): Promise<void>
  hide(): Promise<void>
  getAccessibilityPermission(): Promise<boolean>
  requestAccessibilityPermission(): Promise<boolean>
  onWake(callback: (payload: WakePayload) => void): () => void
}

declare global {
  interface Window { desktop?: DesktopBridge }
}
