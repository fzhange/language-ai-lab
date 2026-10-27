import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, ArrowRightLeft, BookOpen, Check, Clipboard, Copy, LoaderCircle, Send, Settings2, Square, Volume2, X } from 'lucide-react'
import * as Tooltip from '@radix-ui/react-tooltip'
import mark from '../assets/mark.svg'
import { detectLanguage } from './language'
import IconButton from './IconButton'
import MentorAnswer from './MentorAnswer'
import type { ConversationMessage, Language, Settings, TranslationRequest, WakePayload } from './types'

const MAX_LENGTH = 10000
const names = { en: 'English', zh: 'Chinese' }

function messageOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}

export default function App() {
  const desktop = window.desktop
  const [text, setText] = useState('')
  const source = detectLanguage(text)
  const target: Language = source === 'en' ? 'zh' : 'en'
  const [result, setResult] = useState('')
  const [history, setHistory] = useState<ConversationMessage[]>([])
  const [question, setQuestion] = useState('')
  const [pendingQuestion, setPendingQuestion] = useState('')
  const [focus, setFocus] = useState('')
  const [stopped, setStopped] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [speechStarting, setSpeechStarting] = useState(false)
  const [speechError, setSpeechError] = useState('')
  const [settings, setSettings] = useState<Settings>()
  const [draftUrl, setDraftUrl] = useState('')
  const [settingsError, setSettingsError] = useState('')
  const [saving, setSaving] = useState(false)
  const [accessibilityGranted, setAccessibilityGranted] = useState(false)
  const [connection, setConnection] = useState<'checking' | 'online' | 'offline'>('checking')
  const textArea = useRef<HTMLTextAreaElement>(null)
  const followUpArea = useRef<HTMLTextAreaElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const running = useRef(false)
  const requestId = useRef(0)
  const speechId = useRef(0)
  const checkingId = useRef(0)
  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const answerScroll = useRef<HTMLDivElement>(null)
  const followAnswer = useRef(true)
  const count = [...text].length
  const latestAnswer = result || history.at(-1)?.content || ''

  const check = useCallback(async () => {
    if (!desktop) { setConnection('offline'); return }
    const id = ++checkingId.current
    setConnection('checking')
    try {
      const healthy = await desktop.checkConnection()
      if (id === checkingId.current) setConnection(healthy ? 'online' : 'offline')
    } catch { if (id === checkingId.current) setConnection('offline') }
  }, [desktop])

  useEffect(() => {
    let active = true
    if (!desktop) {
      setConnection('offline')
      return
    }
    desktop.getSettings().then((value) => { if (active) setSettings(value) }).catch((error) => {
      if (active) setError(messageOf(error))
    })
    void check()
    desktop.getAccessibilityPermission().then((value) => { if (active) setAccessibilityGranted(value) }).catch(() => {})
    return () => { active = false; clearTimeout(copyTimer.current) }
  }, [desktop, check])

  useEffect(() => {
    if (!desktop) return
    return desktop.onMentorText((payload) => {
      if (payload.requestId === String(requestId.current)) setResult(payload.text)
    })
  }, [desktop])

  useEffect(() => {
    if (!desktop) return
    const unsubscribe = desktop.onSpeechState((payload) => {
      if (payload.requestId !== String(speechId.current)) return
      setSpeaking(payload.speaking)
      setSpeechStarting(false)
      if (payload.error) setSpeechError(payload.error)
    })
    return () => { unsubscribe(); void desktop.stopReading().catch(() => {}) }
  }, [desktop])

  useEffect(() => {
    ++speechId.current
    setSpeaking(false)
    setSpeechStarting(false)
    setSpeechError('')
    void desktop?.stopReading().catch(() => {})
  }, [desktop, text])

  async function readAloud() {
    if (!desktop) return
    if (speaking || speechStarting) {
      ++speechId.current
      setSpeaking(false)
      setSpeechStarting(false)
      try { await desktop.stopReading() } catch (error) { setSpeechError(messageOf(error)) }
      return
    }
    const id = ++speechId.current
    setSpeechError('')
    setSpeechStarting(true)
    try {
      await desktop.readAloud(text, String(id))
    } catch (error) {
      if (id === speechId.current) { setSpeechStarting(false); setSpeaking(false); setSpeechError(messageOf(error)) }
    }
  }

  useEffect(() => {
    if (busy && followAnswer.current && answerScroll.current) {
      answerScroll.current.scrollTop = answerScroll.current.scrollHeight
    }
  }, [result, history, pendingQuestion, busy])

  const runTranslation = useCallback(async (request: TranslationRequest, id: number) => {
    if (!desktop) return
    running.current = true
    setBusy(true)
    setError('')
    setResult('')
    setCopied(false)
    setStopped(false)
    setPendingQuestion(request.follow_up ?? '')
    followAnswer.current = true
    try {
      const translation = await desktop.translate(request, String(id))
      if (id === requestId.current) {
        setHistory((previous) => request.follow_up
          ? [...previous, { role: 'user', content: request.follow_up! }, { role: 'assistant', content: translation }]
          : [{ role: 'assistant', content: translation }])
        setResult('')
        setPendingQuestion('')
        setConnection('online')
      }
    } catch (error) {
      if (id === requestId.current) {
        setError(messageOf(error))
        if (request.follow_up) setQuestion(request.follow_up)
      }
    } finally {
      if (id === requestId.current) { running.current = false; setBusy(false) }
    }
  }, [desktop])

  const translate = useCallback(async () => {
    if (running.current || !text.trim() || count > MAX_LENGTH) return
    setHistory([])
    setQuestion('')
    await runTranslation({ text, focus, source_language: source, target_language: target }, ++requestId.current)
  }, [runTranslation, text, focus, count, source, target])

  const askFollowUp = useCallback(async () => {
    if (running.current || !history.length || !question.trim() || [...question].length > 2000) return
    const followUp = question.trim()
    setQuestion('')
    await runTranslation({ text, focus, source_language: source, target_language: target,
      follow_up: followUp, history }, ++requestId.current)
  }, [runTranslation, text, focus, source, target, question, history])

  useEffect(() => {
    if (!desktop) return
    return desktop.onWake((payload: WakePayload = {}) => {
      textArea.current?.focus()
      void check()
      desktop.getAccessibilityPermission().then(setAccessibilityGranted).catch(() => {})
      if (payload.error) { setError(payload.error); return }
      if (!payload.text?.trim()) return
      dialog.current?.close()
      const selected = payload.text
      const detected = detectLanguage(selected)
      const id = ++requestId.current
      setText(selected)
      setHistory([])
      setQuestion('')
      setPendingQuestion('')
      setFocus('')
      setResult('')
      setCopied(false)
      setStopped(false)
      setError('')
      running.current = true
      setBusy(true)
      // Cancel and drain the prior HTTP request before submitting the new selection.
      void (async () => {
        try {
          await desktop.cancel()
          if (id !== requestId.current) return
          if ([...selected].length > MAX_LENGTH) {
            running.current = false
            setBusy(false)
            return
          }
          await runTranslation({ text: selected, source_language: detected, target_language: detected === 'en' ? 'zh' : 'en' }, id)
        } catch (error) {
          if (id === requestId.current) { setError(messageOf(error)); running.current = false; setBusy(false) }
        }
      })()
    })
  }, [desktop, check, runTranslation])

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (dialog.current?.open || event.defaultPrevented || event.isComposing || event.keyCode === 229) return
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key === 'Enter') {
        event.preventDefault()
        if (!event.repeat) void (event.target === followUpArea.current ? askFollowUp() : translate())
      }
      if (event.key === 'Escape') void desktop?.hide()
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [desktop, translate, askFollowUp])

  function reset(nextText = '') {
    setText(nextText)
    setHistory([])
    setQuestion('')
    setPendingQuestion('')
    setFocus('')
    setResult('')
    setError('')
    setCopied(false)
    setStopped(false)
  }

  async function stop() {
    if (!desktop) return
    // Invalidate the response immediately; a late completion must not repaint it.
    const id = ++requestId.current
    try { await desktop.cancel() } catch (error) { if (id === requestId.current) setError(messageOf(error)) }
    finally { if (id === requestId.current) { running.current = false; setBusy(false); setStopped(true); setQuestion(pendingQuestion) } }
  }

  async function paste() {
    try { reset(await desktop!.readClipboard()); textArea.current?.focus() }
    catch (error) { setError(messageOf(error)) }
  }

  async function copy() {
    try {
      await desktop!.writeClipboard(latestAnswer)
      setCopied(true)
      clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), 2000)
    } catch (error) { setError(messageOf(error)) }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!desktop) return
    setSaving(true)
    setSettingsError('')
    try {
      setSettings(await desktop.saveSettings({ serviceUrl: draftUrl.trim() }))
      dialog.current?.close()
      await check()
    } catch (error) { setSettingsError(messageOf(error)) }
    finally { setSaving(false) }
  }

  return (
    <Tooltip.Provider delayDuration={300}><main className="app">
      <header className="titlebar">
        <div className="brand"><img src={mark} alt="" /><h1>Translate</h1></div>
        <IconButton className="icon-button" label="Settings" disabled={!settings || busy} onClick={() => {
          setDraftUrl(settings!.serviceUrl); setSettingsError(''); dialog.current?.showModal()
          desktop?.getAccessibilityPermission().then(setAccessibilityGranted).catch(() => {})
        }}><Settings2 size={18} /></IconButton>
      </header>

      <section className="workspace" aria-label="Translation workspace">
        <div className="language-bar">
          <div className="language-select">
            <span className="language-code">{source.toUpperCase()}</span>
            <span className="language-name" role="status" aria-label="Source language">{names[source]}</span>
          </div>
          <ArrowRight className="direction-arrow" size={18} />
          <div className="language-select target-language">
            <span className="language-code">{target.toUpperCase()}</span>
            <span className="language-name" role="status" aria-label="Target language">{names[target]}</span>
          </div>
        </div>

        <div className="panes">
          <section className="pane source-pane" aria-label="Source text">
            <div className="pane-header">
              <span>Source</span>
              <div className="pane-tools">
                {source === 'en' && <IconButton className={`icon-button ${speaking ? 'reading' : ''}`} label={speaking || speechStarting ? 'Stop reading' : 'Read English aloud'} disabled={!desktop || !/\p{Script=Latin}/u.test(text) || count > MAX_LENGTH} onClick={() => void readAloud()}>
                  {speaking || speechStarting ? <Square size={15} /> : <Volume2 size={17} />}
                </IconButton>}
                <IconButton className="icon-button" label="Paste text" disabled={busy || !desktop} onClick={() => void paste()}><Clipboard size={16} /></IconButton>
                <IconButton className="icon-button" label="Clear text" disabled={busy || !text} onClick={() => { reset(); textArea.current?.focus() }}><X size={17} /></IconButton>
              </div>
            </div>
            <textarea ref={textArea} aria-label="Text to translate" placeholder="Enter a word, phrase, or sentence..." value={text} readOnly={busy} spellCheck={false} autoFocus onChange={(event) => reset(event.target.value)} onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
              if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
                event.preventDefault()
                if (!event.repeat) void translate()
              }
            }} />
            <div className={`character-count ${count > MAX_LENGTH ? 'over-limit' : ''}`} aria-live="polite">{count.toLocaleString()} / 10,000</div>
            {speechError && <div className="speech-error" role="alert">{speechError}</div>}
            <div className="focus-field"><label htmlFor="focus-word">Focus word or phrase <span>Optional</span></label>
              <input id="focus-word" value={focus} disabled={busy} maxLength={200} placeholder="capture" onChange={(event) => {
                setFocus(event.target.value); setResult(''); setHistory([]); setQuestion(''); setPendingQuestion(''); setError('')
              }} /></div>
          </section>

          <section className="pane result-pane" aria-label="Mentor explanation">
            <div className="pane-header"><span className="mentor-label"><BookOpen size={15} />Language mentor</span>
              <IconButton className={`icon-button ${copied ? 'copied' : ''}`} label={copied ? 'Copied' : 'Copy explanation'} disabled={!latestAnswer || busy || !desktop} onClick={() => void copy()}>{copied ? <Check size={16} /> : <Copy size={16} />}</IconButton>
            </div>
            <div ref={answerScroll} className={`translation-output ${!latestAnswer ? 'empty' : ''}`} aria-busy={busy} onScroll={() => {
              const el = answerScroll.current!
              followAnswer.current = el.scrollHeight - el.scrollTop - el.clientHeight < 70
            }}>
              {history.map((message, index) => message.role === 'user'
                ? <div key={index} className="learner-question">{message.content}</div>
                : <article key={index} className="mentor-turn"><MentorAnswer text={message.content} /></article>)}
              {pendingQuestion && <div className="learner-question">{pendingQuestion}</div>}
              {result ? <article className="mentor-turn"><MentorAnswer text={result} /></article> : busy ? <div className="loading"><LoaderCircle size={20} className="spin" /><span>Thinking...</span></div> : null}
            </div>
            <div className="output-meta" role="status">{busy ? <><LoaderCircle size={12} className="spin" />Explaining...</> : copied ? 'Copied to clipboard' : stopped ? 'Stopped · Partial explanation' : latestAnswer ? 'Language mentor' : ''}</div>
            {history.length > 0 && <form className="follow-up-composer" onSubmit={(event) => { event.preventDefault(); void askFollowUp() }}>
              <textarea ref={followUpArea} aria-label="Follow-up question" placeholder="Ask a follow-up..." rows={2} value={question} readOnly={busy} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
                if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
                  event.preventDefault()
                  if (!event.repeat) void askFollowUp()
                }
              }} />
              <IconButton className="icon-button send-question" label="Send follow-up" type="submit" disabled={!desktop || busy || !question.trim() || [...question].length > 2000}><Send size={17} /></IconButton>
            </form>}
            {[...question].length > 2000 && <div className="follow-up-limit" role="alert">Follow-up questions are limited to 2,000 characters.</div>}
          </section>
        </div>

        {error && <div className="error-banner" role="alert"><span>{error}</span><IconButton className="icon-button" label="Dismiss error" onClick={() => setError('')}><X size={16} /></IconButton></div>}
        {count > MAX_LENGTH && <div className="limit-error" role="alert">Text is limited to 10,000 characters.</div>}
        {settings && !settings.shortcutRegistered && <div className="shortcut-warning" role="alert">Command+B is unavailable. Another app may be using this shortcut.</div>}

        <div className="action-bar">
          <button className="connection" disabled={!desktop || connection === 'checking'} onClick={() => void check()} aria-label="Check service connection" title={settings?.serviceUrl}>
            <span className={`status-dot ${connection}`} />
            {desktop ? connection === 'online' ? 'Service connected' : connection === 'checking' ? 'Connecting...' : 'Service offline' : 'Desktop connection unavailable'}
          </button>
          {busy ? <button className="translate-button stop-button" onClick={() => void stop()}><Square size={14} />Stop</button> :
            <button className="translate-button" disabled={!desktop || !text.trim() || count > MAX_LENGTH} onClick={() => void translate()}>Explain<ArrowRight size={17} /></button>}
        </div>
      </section>

      <footer><span>Language AI Lab</span><span className="language-pair">English <ArrowRightLeft size={12} /> Chinese</span></footer>

      <dialog ref={dialog} aria-labelledby="settings-title" className="settings-dialog">
        <form onSubmit={(event) => void save(event)}>
          <div className="dialog-header"><h2 id="settings-title">Settings</h2><IconButton className="icon-button" label="Close settings" onClick={() => dialog.current?.close()}><X size={18} /></IconButton></div>
          <label htmlFor="service-url">Agent service URL</label>
          <input id="service-url" type="url" autoComplete="off" required value={draftUrl} onChange={(event) => setDraftUrl(event.target.value)} />
          <div className="setting-row"><span>Global shortcut</span><span className="shortcut-keys"><kbd>Command</kbd><span>+</span><kbd>B</kbd></span></div>
          <div className="setting-row"><span>Accessibility</span>{accessibilityGranted ? <span className="permission-granted"><Check size={14} />Allowed</span> :
            <button className="secondary-button" type="button" onClick={() => {
              desktop?.requestAccessibilityPermission().then(setAccessibilityGranted).catch((error) => setSettingsError(messageOf(error)))
            }}>Allow Access</button>}</div>
          {settingsError && <p className="settings-error" role="alert">{settingsError}</p>}
          <div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => dialog.current?.close()}>Cancel</button><button className="translate-button" type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}Save</button></div>
        </form>
      </dialog>
    </main></Tooltip.Provider>
  )
}
