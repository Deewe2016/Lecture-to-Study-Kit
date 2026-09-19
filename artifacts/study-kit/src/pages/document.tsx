import { useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import { getAccessToken } from '@/lib/auth';

type DocumentRow = {
  id: string;
  title: string;
  content: unknown;
  updated_at: string;
  created_at: string;
};

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

async function fetchDocument(id: string): Promise<DocumentRow> {
  const token = getAccessToken();
  if (!token || !supabaseUrl || !anonKey) {
    throw new Error('Document storage is not configured.');
  }

  const response = await fetch(
    supabaseUrl + '/rest/v1/documents?id=eq.' + encodeURIComponent(id) + '&select=*',
    {
      headers: {
        apikey: anonKey,
        Authorization: 'Bearer ' + token,
      },
    },
  );

  if (!response.ok) {
    throw new Error('Could not load document.');
  }

  const rows = (await response.json()) as DocumentRow[];
  if (!rows[0]) {
    throw new Error('Document not found.');
  }

  return rows[0];
}

async function saveDocument(
  documentId: string,
  title: string,
  content: unknown,
): Promise<void> {
  const token = getAccessToken();
  if (!token || !supabaseUrl || !anonKey) {
    throw new Error('Document storage is not configured.');
  }

  const response = await fetch(
    supabaseUrl + '/rest/v1/documents?id=eq.' + encodeURIComponent(documentId),
    {
      method: 'PATCH',
      headers: {
        apikey: anonKey,
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: title.trim() || 'Untitled Document',
        content,
        updated_at: new Date().toISOString(),
      }),
    },
  );

  if (!response.ok) {
    throw new Error('Could not save document.');
  }
}

function getInitialContent(content: unknown) {
  if (
    content &&
    typeof content === 'object' &&
    'type' in content &&
    (content as { type?: unknown }).type === 'doc'
  ) {
    return content;
  }

  if (typeof content === 'string' && content.trim()) {
    try {
      const parsed = JSON.parse(content);
      if (
        parsed &&
        typeof parsed === 'object' &&
        parsed.type === 'doc'
      ) {
        return parsed;
      }
    } catch {
      return '<p></p>';
    }
  }

  return '<p></p>';
}

export default function DocumentPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [document, setDocument] = useState<DocumentRow | null>(null);
  const [title, setTitle] = useState('Untitled Document');
  const titleRef = useRef('Untitled Document');
  const [status, setStatus] = useState('Loading...');
  const [error, setError] = useState('');
  const readyRef = useRef(false);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, Underline],
    content: '<p></p>',
    onUpdate: () => {
      setStatus('Unsaved changes');
    },
  });

  useEffect(() => {
    let cancelled = false;

    void fetchDocument(id)
      .then((loaded) => {
        if (cancelled) return;
        setDocument(loaded);
        titleRef.current = loaded.title || 'Untitled Document';
        setTitle(titleRef.current);
        setStatus('Saved');
        readyRef.current = true;
      })
      .catch((loadError) => {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : 'Could not load document.');
        setStatus('Error');
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!editor || !document || !readyRef.current) return;
    editor.commands.setContent(getInitialContent(document.content), {
      emitUpdate: false,
    });
  }, [editor, document]);

  const save = async () => {
    if (!editor || !document) return;

    setStatus('Saving...');

    try {
      await saveDocument(
        document.id,
        titleRef.current,
        editor.getJSON(),
      );
      setStatus('Saved');
    } catch (saveError) {
      setStatus('Error');
      setError(saveError instanceof Error ? saveError.message : 'Could not save document.');
    }
  };

  useEffect(() => {
    if (!editor || !document) return;

    const timer = window.setInterval(() => {
      void save();
    }, 30000);

    return () => window.clearInterval(timer);
  }, [editor, document]);

  if (status === 'Error' && !document) {
    return (
      <main className="document-editor-error">
        <div>
          <p>{error || 'Could not open this document.'}</p>
          <button
            type="button"
            className="document-editor-button"
            onClick={() => window.location.assign('/files')}
          >
            Back to Files
          </button>
        </div>
      </main>
    );
  }

  if (!editor || !document) {
    return <main className="document-editor-loading">Loading document...</main>;
  }

  return (
    <main className="document-editor-page">
      <header className="document-editor-header">
        <button
          type="button"
          className="document-editor-button"
          onClick={() => void save().then(() => window.location.assign('/files'))}
        >
          Back to Files
        </button>

        <input
          className="document-editor-title"
          value={title}
          aria-label="Document title"
          onChange={(event) => {
            titleRef.current = event.target.value;
            setTitle(event.target.value);
            setStatus('Unsaved changes');
          }}
          onBlur={() => void save()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            }
          }}
        />

        <span className="document-editor-status">{status}</span>
      </header>

      <div className="document-editor-toolbar" role="toolbar" aria-label="Text formatting">
        <button
          type="button"
          className="document-editor-toolbar-button"
          aria-label="Bold"
          aria-pressed={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          className="document-editor-toolbar-button"
          aria-label="Italic"
          aria-pressed={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <em>I</em>
        </button>
        <button
          type="button"
          className="document-editor-toolbar-button"
          aria-label="Underline"
          aria-pressed={editor.isActive('underline')}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <u>U</u>
        </button>
      </div>

      <section className="document-editor-workspace">
        <div className="document-editor-paper">
          <EditorContent editor={editor} />
        </div>
      </section>
    </main>
  );
}
