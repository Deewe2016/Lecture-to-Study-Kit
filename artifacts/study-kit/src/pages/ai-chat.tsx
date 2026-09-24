import { FormEvent, useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { Bot, FileText, MessageSquare, Paperclip, Plus, Send, Sparkles, Trash2, User, X } from 'lucide-react';
import { getAccessToken, getStoredUser } from '@/lib/auth';

type Attachment = {
  id: string;
  name: string;
  type: string;
  kind: 'pdf' | 'txt' | 'image';
  content?: string;
  storagePath?: string;
};

type SentAttachment = {
  id: string;
  name: string;
  type: string;
};

type FileRow = {
  id: string;
  name: string;
  storage_path: string;
  size: number;
  type: string;
  created_at: string;
};

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  kitId?: string;
  attachments?: SentAttachment[];
};

type Conversation = {
  id: string;
  messages: Message[];
  createdAt: number;
};

const STORAGE_KEY = 'lecture-study-ai-conversations';
const LEGACY_STORAGE_KEY = 'lecture-study-ai-chat';
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

function makeId() {
  return `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeMessages(value: unknown): Message[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (message): message is Message =>
      message?.role === 'user' || message?.role === 'assistant',
  ).map((message) => ({
    id: String(message.id || makeId()),
    role: message.role,
    content: String(message.content || ''),
    kitId: message.kitId ? String(message.kitId) : undefined,
    attachments: Array.isArray(message.attachments)
      ? message.attachments.filter((item) => item?.name).map((item) => ({
          id: String(item.id || makeId()),
          name: String(item.name),
          type: String(item.type || ''),
        }))
      : undefined,
  })).filter((message) => message.content.trim() || message.attachments?.length);
}

function readConversations(): Conversation[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return parsed.map((conversation) => ({
          id: String(conversation.id || makeId()),
          messages: normalizeMessages(conversation.messages),
          createdAt: Number(conversation.createdAt) || Date.now(),
        })).filter((conversation) => conversation.messages.length > 0);
      }
    }

    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      const messages = normalizeMessages(JSON.parse(legacy));
      if (messages.length) {
        return [{ id: makeId(), messages, createdAt: Date.now() }];
      }
    }
  } catch (error) {
    console.error("AI Chat local storage read error:", error);
    // Ignore malformed local storage and start clean.
  }
  return [];
}

function conversationTitle(conversation: Conversation) {
  const firstUserMessage = conversation.messages.find((message) => message.role === 'user');
  const text = firstUserMessage?.content.trim() || 'New conversation';
  return text.length > 30 ? `${text.slice(0, 30)}…` : text;
}

function renderMarkdown(text: string) {
  const html = DOMPurify.sanitize(marked.parse(text, { gfm: true, breaks: true }) as string);

  return (
    <div
      className="[&_h1]:mb-3 [&_h1]:mt-5 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mb-3 [&_h2]:mt-5 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-lg [&_h3]:font-semibold [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 [&_hr]:my-4 [&_hr]:border-border [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-zinc-950 [&_pre]:p-4 [&_pre]:font-mono [&_pre]:text-sm [&_pre]:leading-5 [&_pre]:text-zinc-100 [&_code]:rounded [&_code]:bg-secondary [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em] [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-inherit [&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_table]:text-left [&_table]:text-sm [&_th]:border [&_th]:border-border [&_th]:bg-secondary/80 [&_th]:px-3 [&_th]:py-2 [&_th]:font-semibold [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_tbody_tr:nth-child(odd)]:bg-card [&_tbody_tr:nth-child(even)]:bg-secondary/35"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function kindForFile(name: string, type: string): Attachment['kind'] | null {
  if (type.includes('pdf') || /\\.pdf$/i.test(name)) return 'pdf';
  if (type.startsWith('image/')) return 'image';
  if (type.includes('text') || /\\.(txt|md)$/i.test(name)) return 'txt';
  return null;
}

async function readPdfText(data: ArrayBuffer) {
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const text = await page.getTextContent();
    pages.push(text.items.map((item: any) => 'str' in item ? item.str : '').join(' '));
  }
  return pages.join('\\n\\n').trim();
}

function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Could not read the image.'));
    reader.readAsDataURL(file);
  });
}

export default function AIChatPage() {
  const [conversations, setConversations] = useState<Conversation[]>(readConversations);
  const [selectedId, setSelectedId] = useState<string | null>(() => readConversations()[0]?.id || null);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState('');
  const [attachmentWarning, setAttachmentWarning] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [filesModalOpen, setFilesModalOpen] = useState(false);
  const [userFiles, setUserFiles] = useState<FileRow[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [processingAttachment, setProcessingAttachment] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const selected = conversations.find((conversation) => conversation.id === selectedId) || null;
  const messages = selected?.messages || [];

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  }, [conversations]);

  useEffect(() => {
    if (!selectedId && conversations.length) setSelectedId(conversations[0].id);
  }, [conversations, selectedId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    const pending = localStorage.getItem('dive-deeper-message');
    if (!pending) return;
    localStorage.removeItem('dive-deeper-message');
    const newConversation = { id: makeId(), messages: [], createdAt: Date.now() };
    setConversations(prev => [newConversation, ...prev]);
    setSelectedId(newConversation.id);
    setTimeout(() => sendMessage(undefined, pending), 300);
  }, []);

  const updateMessages = (conversationId: string, updater: (current: Message[]) => Message[]) => {
    setConversations((current) => current.map((conversation) =>
      conversation.id === conversationId
        ? { ...conversation, messages: updater(conversation.messages) }
        : conversation,
    ));
  };

  const newConversation = () => {
    abortRef.current?.abort();
    const conversation: Conversation = { id: makeId(), messages: [], createdAt: Date.now() };
    setConversations((current) => [conversation, ...current]);
    setSelectedId(conversation.id);
    setInput('');
    setAttachments([]);
    setError('');
    setAttachmentWarning('');
    setThinking(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const deleteConversation = (id: string) => {
    if (id === selectedId) abortRef.current?.abort();
    setConversations((current) => current.filter((conversation) => conversation.id !== id));
    if (id === selectedId) {
      const remaining = conversations.filter((conversation) => conversation.id !== id);
      setSelectedId(remaining[0]?.id || null);
      setInput('');
      setAttachments([]);
      setError('');
      setThinking(false);
    }
  };

  const selectConversation = (id: string) => {
    if (id === selectedId) return;
    abortRef.current?.abort();
    setSelectedId(id);
    setInput('');
    setAttachments([]);
    setError('');
    setThinking(false);
  };

  const saveGeneratedKit = (kit: any, materials: Array<{ name: string; kind: string; text: string }>) => {
    const localKit = {
      ...kit,
      id: String(kit.id || `kit-${Date.now()}`),
      materials,
      createdAt: new Date().toISOString(),
    };
    try {
      const raw = localStorage.getItem('lecture-study-kits');
      const current = raw ? JSON.parse(raw) : [];
      const next = Array.isArray(current)
        ? current.filter((item: any) => item?.id !== localKit.id)
        : [];
      localStorage.setItem('lecture-study-kits', JSON.stringify([localKit, ...next]));
    } catch {
      localStorage.setItem('lecture-study-kits', JSON.stringify([localKit]));
    }
    return localKit;
  };

  const makeStudyKitFromCommand = (topic: string, conversationId: string, history: Message[]) => {
    const assistantMessage: Message = { id: makeId(), role: 'assistant', content: 'Your study kit is ready!' };
    updateMessages(conversationId, () => [...history, assistantMessage]);
    setInput('');
    setAttachments([]);
    setError('');
    setThinking(true);
    void (async () => {
      try {
        const response = await fetch('/api/generate-kit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: topic, title: topic, planDays: 7 }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data) throw new Error(data?.error || 'Could not generate the study kit.');
        const kit = saveGeneratedKit(data, [{
          name: `AI prompt · ${topic}`,
          kind: 'prompt',
          text: topic,
        }]);
        updateMessages(conversationId, current => current.map(message =>
          message.id === assistantMessage.id ? { ...message, kitId: kit.id } : message,
        ));
      } catch (requestError) {
        const message = requestError instanceof Error ? requestError.message : 'Could not generate the study kit.';
        setError(message);
        updateMessages(conversationId, current => current.filter(item => item.id !== assistantMessage.id));
      } finally {
        setThinking(false);
      }
    })();
  };

  const loadUserFiles = async () => {
    const me = getStoredUser();
    if (!me || !SUPABASE_URL || !SUPABASE_ANON_KEY || !getAccessToken()) {
      setError('You must be signed in to choose a file.');
      return;
    }
    setLoadingFiles(true);
    setError('');
    try {
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/files?select=id,name,storage_path,size,type,created_at&owner_id=eq.${encodeURIComponent(me.id)}&order=created_at.desc`,
        {
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${getAccessToken()}`,
          },
        },
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.message || data?.details || 'Could not load your files.');
      setUserFiles(Array.isArray(data) ? data : []);
      setFilesModalOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your files.');
    } finally {
      setLoadingFiles(false);
    }
  };

  const getSignedFileUrl = async (file: FileRow) => {
    const token = getAccessToken();
    if (!token) throw new Error('You must be signed in to use your files.');
    const response = await fetch(
      `${SUPABASE_URL}/storage/v1/object/sign/user-files/${file.storage_path.split('/').map(encodeURIComponent).join('/')}`,
      {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expiresIn: 600 }),
      },
    );
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.message || data?.details || 'Could not access that file.');
    return data.signedURL?.startsWith('http') ? data.signedURL : `${SUPABASE_URL}/storage/v1${data.signedURL}`;
  };

  const prepareFile = async (file: globalThis.File, source: 'upload' | 'files', storagePath?: string, fileId?: string) => {
    const kind = kindForFile(file.name, file.type);
    if (!kind) throw new Error('AI Chat attachments support PDF, TXT, and image files only.');

    const id = fileId || makeId();
    let content = '';
    if (kind === 'txt') {
      content = await file.text();
    } else if (kind === 'pdf') {
      content = await readPdfText(await file.arrayBuffer());
    } else {
      content = await fileToDataUrl(file);
    }

    if (!content.trim()) throw new Error(`${file.name} does not contain readable content.`);
    setAttachments(current => [...current, { id, name: file.name, type: file.type, kind, content, storagePath }]);
  };

  const handleFilePicker = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files || []);
    event.currentTarget.value = '';
    if (!picked.length) return;
    setAttachmentMenuOpen(false);
    setProcessingAttachment(true);
    setError('');
    setAttachmentWarning('');
    for (const file of picked) {
      try {
        await prepareFile(file, 'upload');
      } catch (e) {
        console.error('AI Chat file processing error:', e);
        const kind = kindForFile(file.name, file.type);
        if (kind) {
          setAttachments(current => [...current, {
            id: makeId(),
            name: file.name,
            type: file.type,
            kind,
            content: '',
          }]);
        }
        setAttachmentWarning('Could not read file, sending message without attachment');
      }
    }
    try {
      // Keep the send path available even when one or more files could not be read.
    } catch (e) {
      console.error('AI Chat attachment processing wrapper error:', e);
    } finally {
      setProcessingAttachment(false);
    }
  };

  const chooseExistingFile = async (file: FileRow) => {
    const kind = kindForFile(file.name, file.type);
    if (!kind) {
      setError('Only PDF, TXT, and image files can be attached to AI Chat.');
      return;
    }
    setProcessingAttachment(true);
    setError('');
    setAttachmentWarning('');
    try {
      const signedUrl = await getSignedFileUrl(file);
      const response = await fetch(signedUrl);
      if (!response.ok) throw new Error('Could not download the selected file.');
      const blob = await response.blob();
      const attachedFile = new globalThis.File([blob], file.name, { type: file.type || blob.type });
      await prepareFile(attachedFile, 'files', file.storage_path, file.id);
      setFilesModalOpen(false);
      setAttachmentMenuOpen(false);
    } catch (e) {
      console.error('AI Chat existing-file processing error:', e);
      setAttachmentWarning('Could not read file, sending message without attachment');
      setAttachments(current => [...current, {
        id: file.id || makeId(),
        name: file.name,
        type: file.type,
        kind,
        content: '',
        storagePath: file.storage_path,
      }]);
      setFilesModalOpen(false);
      setAttachmentMenuOpen(false);
    } finally {
      setProcessingAttachment(false);
    }
  };

  const sendMessage = async (event?: FormEvent, overrideContent?: string) => {
    event?.preventDefault();
    const typedContent = overrideContent ?? input.trim();
    if ((!typedContent && !attachments.length) || thinking || processingAttachment) return;

    const content = typedContent || 'Attached file(s).';
    const kitCommand = content.match(/^make\\s+(?:a\\s+)?(.+?)\\s+study\\s+kit$/i);

    let conversationId = selectedId;
    if (!conversationId) {
      const conversation: Conversation = { id: makeId(), messages: [], createdAt: Date.now() };
      conversationId = conversation.id;
      setConversations((current) => [conversation, ...current]);
      setSelectedId(conversation.id);
    }

    const currentConversation = conversations.find((conversation) => conversation.id === conversationId);
    const sentAttachments = attachments.map(({ id, name, type }) => ({ id, name, type }));
    const history = [
      ...(currentConversation?.messages || []),
      {
        id: makeId(),
        role: 'user' as const,
        content,
        attachments: sentAttachments,
      },
    ];

    if (kitCommand) {
      makeStudyKitFromCommand(kitCommand[1].trim(), conversationId, history);
      return;
    }

    const assistantMessage: Message = { id: makeId(), role: 'assistant', content: '' };
    updateMessages(conversationId, () => [...history, assistantMessage]);
    setInput('');
    setAttachments([]);
    setError('');
    setThinking(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      let requestAttachments: Array<{ name: string; type: string; kind: Attachment['kind']; content?: string }> = [];
      try {
        requestAttachments = attachments.map(({ name, type, kind, content: attachmentContent }) => ({
          name,
          type,
          kind,
          content: kind === 'image' ? undefined : attachmentContent,
        }));
      } catch (attachmentError) {
        console.error('AI Chat attachment payload error:', attachmentError);
        requestAttachments = [];
        setAttachmentWarning('Could not read file, sending message without attachment');
      }

      const requestBody = {
        messages: history.slice(-20).map(({ role, content: text }) => ({ role, content: text })),
        attachments: requestAttachments,
      };
      console.log("AI Chat sending request to /api/ai-chat:", requestBody);
      const response = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const details = await response.text().catch((error) => {
          console.error("AI Chat error response read failed:", error);
          return '';
        });
        throw new Error(details || `AI Chat request failed (${response.status}).`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamHadContent = false;
      let doneReading = false;

      while (!doneReading) {
        const result = await reader.read();
        doneReading = result.done;
        if (result.value) buffer += decoder.decode(result.value, { stream: !result.done });

        const events = buffer.split(/\\r?\\n\\r?\\n/);
        buffer = events.pop() || '';

        for (const eventText of events) {
          for (const line of eventText.split(/\\r?\\n/)) {
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (!data || data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.error) throw new Error(parsed.error);
              const delta = typeof parsed.content === 'string' ? parsed.content : '';
              if (delta) {
                streamHadContent = true;
                updateMessages(conversationId!, (current) => current.map((message) =>
                  message.id === assistantMessage.id
                    ? { ...message, content: message.content + delta }
                    : message,
                ));
              }
            } catch (parseError) {
              console.error("AI Chat SSE parse error:", parseError);
              if (parseError instanceof Error && parseError.message !== 'Unexpected end of JSON input') {
                throw parseError;
              }
            }
          }
        }
      }

      if (buffer.trim()) {
        for (const line of buffer.split(/\r?\n/)) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) throw new Error(parsed.error);
            const delta = typeof parsed.content === 'string' ? parsed.content : '';
            if (delta) {
              streamHadContent = true;
              updateMessages(conversationId!, (current) => current.map((message) =>
                message.id === assistantMessage.id
                  ? { ...message, content: message.content + delta }
                  : message,
              ));
            }
          } catch (parseError) {
            console.error('AI Chat final SSE parse error:', parseError);
            throw parseError;
          }
        }
      }

      if (!streamHadContent) {
        throw new Error('AI Chat returned an empty response.');
      }
    } catch (requestError) {
      console.error("AI Chat frontend request error:", requestError);
      if (controller.signal.aborted) return;
      const message = requestError instanceof Error ? requestError.message : 'AI Chat is unavailable.';
      setError(message);
      updateMessages(conversationId!, (current) => current.filter((item) => item.id !== assistantMessage.id));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setThinking(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  };

  return (
    <div className="relative flex h-[calc(100dvh-72px)] min-h-0">
      <aside className="hidden w-[270px] shrink-0 flex-col border-r border-border/70 bg-sidebar/40 lg:flex">
        <div className="flex items-center justify-between border-b border-border/70 px-4 py-4">
          <span className="text-sm font-medium text-foreground">AI conversations</span>
          <button
            onClick={newConversation}
            className="focus-ring flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-secondary text-muted-foreground hover:text-foreground"
            title="New conversation"
            aria-label="New conversation"
            data-testid="button-new-ai-conversation-sidebar"
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {conversations.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">No conversations yet.</div>
          ) : conversations.map((conversation) => (
            <div key={conversation.id} className={`group mb-1 flex items-center gap-1 rounded-lg ${conversation.id === selectedId ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/60'}`}>
              <button
                onClick={() => selectConversation(conversation.id)}
                className="focus-ring flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm text-sidebar-foreground"
                data-testid={`button-ai-conversation-${conversation.id}`}
              >
                <MessageSquare size={15} className="shrink-0 text-muted-foreground" />
                <span className="truncate">{conversationTitle(conversation)}</span>
              </button>
              <button
                onClick={() => deleteConversation(conversation.id)}
                className="focus-ring mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus:opacity-100"
                title="Delete conversation"
                aria-label={`Delete ${conversationTitle(conversation)}`}
                data-testid={`button-delete-ai-conversation-${conversation.id}`}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-5 py-4 sm:px-8">
          <button
            onClick={newConversation}
            className="focus-ring inline-flex items-center gap-2 rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground transition-colors hover:border-primary/50 hover:bg-secondary/80"
            data-testid="button-new-ai-conversation"
          >
            <Plus size={16} />
            <span>New conversation</span>
          </button>

          <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="label-powered-by-groq">
            <Sparkles size={14} />
            <span>Powered by Groq</span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 sm:px-8">
          <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col justify-end gap-5 py-6">
            {messages.length === 0 && !thinking && (
              <div className="m-auto flex max-w-lg flex-col items-center text-center">
                <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-secondary text-primary">
                  <Sparkles size={25} />
                </div>
                <h1 className="font-serif text-3xl tracking-[-.03em] text-foreground">AI Chat</h1>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Ask anything and get a response from your AI study assistant.
                </p>
              </div>
            )}

            {messages.map((message) => (
              <div key={message.id} className={`flex items-end gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {message.role === 'assistant' && (
                  <div className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-secondary text-primary sm:flex">
                    <Bot size={15} />
                  </div>
                )}
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${message.role === 'user'
                    ? 'rounded-br-md bg-primary text-primary-foreground'
                    : 'rounded-bl-md border border-border bg-card text-card-foreground'}`}
                >
                  {message.role === 'user' && message.attachments?.length ? (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {message.attachments.map((attachment) => (
                        <div key={attachment.id} className="inline-flex max-w-[220px] items-center gap-1.5 rounded-md border border-current/20 bg-black/10 px-2 py-1 text-[10px]">
                          <FileText size={12} className="shrink-0" />
                          <span className="truncate">{attachment.name}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {message.content ? (message.role === 'assistant' ? (
                    <div>
                      {renderMarkdown(message.content)}
                      {message.kitId && (
                        <button
                          type="button"
                          onClick={() => window.location.assign(`/kit/${message.kitId}`)}
                          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                        >
                          <Sparkles size={14} />
                          Open Kit
                        </button>
                      )}
                    </div>
                  ) : <div className="whitespace-pre-wrap">{message.content}</div>) : (thinking && message.role === 'assistant' ? (
                    <span className="inline-flex items-center gap-1.5 py-1" aria-label="AI is thinking">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:150ms]" />
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:300ms]" />
                    </span>
                  ) : null)}
                </div>
                {message.role === 'user' && (
                  <div className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-secondary text-muted-foreground sm:flex">
                    <User size={15} />
                  </div>
                )}
              </div>
            ))}

            {thinking && messages.length > 0 && messages[messages.length - 1]?.content && (
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <div className="h-8 w-8 shrink-0 rounded-full border border-border bg-secondary" />
                <span>Thinking…</span>
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
                {error}
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        <div className="border-t border-border/70 bg-background/95 px-4 py-4 backdrop-blur sm:px-8">
          <div className="mx-auto w-full max-w-5xl">
            {attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {attachments.map((attachment) => (
                  <div key={attachment.id} className="flex max-w-[240px] items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs">
                    <FileText size={13} className="shrink-0 text-primary" />
                    <span className="truncate">{attachment.name}</span>
                    <button
                      type="button"
                      onClick={() => setAttachments(current => current.filter(item => item.id !== attachment.id))}
                      className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                      aria-label={`Remove ${attachment.name}`}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {attachmentWarning && (
              <div className="mb-2 text-xs text-muted-foreground" role="status">
                {attachmentWarning}
              </div>
            )}

            <form onSubmit={(event) => void sendMessage(event)} className="flex w-full items-end gap-2">
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setAttachmentMenuOpen(value => !value)}
                  disabled={thinking || processingAttachment}
                  className="focus-ring flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Attach file"
                  aria-expanded={attachmentMenuOpen}
                  data-testid="button-ai-chat-attachment"
                >
                  <Paperclip size={18} />
                </button>

                {attachmentMenuOpen && (
                  <div className="absolute bottom-14 left-0 z-50 w-56 rounded-xl border border-border bg-card p-1.5 shadow-2xl">
                    <button
                      type="button"
                      onClick={() => {
                        setAttachmentMenuOpen(false);
                        fileInputRef.current?.click();
                      }}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-secondary"
                    >
                      <Paperclip size={16} className="text-primary" />
                      <span>Upload file</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAttachmentMenuOpen(false);
                        void loadUserFiles();
                      }}
                      disabled={loadingFiles}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-secondary disabled:opacity-50"
                    >
                      <FileText size={16} className="text-primary" />
                      <span>Choose from Files</span>
                    </button>
                  </div>
                )}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.txt,text/plain,application/pdf,image/*"
                multiple
                className="hidden"
                onChange={(event) => void handleFilePicker(event)}
              />

              <textarea
                ref={textareaRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Message AI Chat…"
                rows={1}
                disabled={thinking}
                className="focus-ring min-h-12 max-h-36 flex-1 resize-none rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-70"
                data-testid="input-ai-chat"
              />
              <button
                type="submit"
                disabled={(!input.trim() && !attachments.length) || thinking || processingAttachment}
                className="focus-ring flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Send message"
                data-testid="button-send-ai-chat"
              >
                <Send size={17} />
              </button>
            </form>
          </div>
        </div>
      </div>

      {filesModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-5" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setFilesModalOpen(false);
        }}>
          <div className="flex max-h-[80vh] w-full max-w-xl flex-col rounded-2xl border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="font-serif text-xl">Choose from Files</h2>
                <p className="mt-1 text-xs text-muted-foreground">Select a PDF, TXT, or image from your Files.</p>
              </div>
              <button type="button" onClick={() => setFilesModalOpen(false)} className="rounded-lg p-2 text-muted-foreground hover:bg-secondary" aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <div className="min-h-0 overflow-y-auto p-3">
              {loadingFiles ? (
                <div className="p-10 text-center text-sm text-muted-foreground">Loading files…</div>
              ) : userFiles.length === 0 ? (
                <div className="p-10 text-center text-sm text-muted-foreground">No files found.</div>
              ) : (
                <div className="space-y-1">
                  {userFiles.map((file) => {
                    const supported = Boolean(kindForFile(file.name, file.type));
                    return (
                      <button
                        key={file.id}
                        type="button"
                        disabled={!supported || processingAttachment}
                        onClick={() => void chooseExistingFile(file)}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <FileText size={17} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{file.name}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {file.type || 'Unknown type'} · {Math.max(1, Math.round(Number(file.size || 0) / 1024))} KB
                          </p>
                        </div>
                        {!supported && <span className="text-[10px] text-muted-foreground">Not supported</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
