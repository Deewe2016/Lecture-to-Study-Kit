import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Color from '@tiptap/extension-color';
import TextStyle from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import { getAccessToken } from '@/lib/auth';

type DocumentRow = {
  id: string;
  title: string;
  content: unknown;
  updated_at: string;
  created_at: string;
};

const FONT_FAMILIES = ['Arial', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana'];
const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 64, 72, 96];
const FONT_SIZE_SET = new Set(FONT_SIZES);
const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

const StyledText = TextStyle.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      fontFamily: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-font-family'),
        renderHTML: (attributes: { fontFamily?: string | null }) => {
          const family = attributes.fontFamily;
          return family && FONT_FAMILIES.includes(family)
            ? { class: 'document-font-' + family.toLowerCase().replaceAll(' ', '-') }
            : {};
        },
      },
      fontSize: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const value = Number(element.getAttribute('data-font-size'));
          return FONT_SIZE_SET.has(value) ? value : null;
        },
        renderHTML: (attributes: { fontSize?: number | null }) => {
          const size = attributes.fontSize;
          return typeof size === 'number' && FONT_SIZE_SET.has(size)
            ? { class: 'document-font-size-' + size, 'data-font-size': String(size) }
            : {};
        },
      },
    };
  },
});

const Indent = TextStyle.extend({
  name: 'indent',
  addAttributes() {
    return {
      ...this.parent?.(),
      indent: {
        default: 0,
        parseHTML: (element: HTMLElement) => {
          const value = Number(element.getAttribute('data-indent'));
          return Number.isInteger(value) && value >= 0 && value <= 8 ? value : 0;
        },
        renderHTML: (attributes: { indent?: number }) => {
          const value = attributes.indent || 0;
          return value > 0 ? { class: 'document-indent-' + value, 'data-indent': String(value) } : {};
        },
      },
    };
  },
});

async function fetchDocument(id: string): Promise<DocumentRow> {
  const token = getAccessToken();
  if (!token || !supabaseUrl || !anonKey) throw new Error('Document storage is not configured.');

  const response = await fetch(
    supabaseUrl + '/rest/v1/documents?id=eq.' + encodeURIComponent(id) + '&select=*',
    { headers: { apikey: anonKey, Authorization: 'Bearer ' + token } },
  );

  if (!response.ok) throw new Error('Could not load document.');
  const rows = (await response.json()) as DocumentRow[];
  if (!rows[0]) throw new Error('Document not found.');
  return rows[0];
}

async function saveDocument(documentId: string, title: string, content: unknown): Promise<void> {
  const token = getAccessToken();
  if (!token || !supabaseUrl || !anonKey) throw new Error('Document storage is not configured.');

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

  if (!response.ok) throw new Error('Could not save document.');
}

function getInitialContent(content: unknown) {
  if (content && typeof content === 'object' && 'type' in content && (content as { type?: unknown }).type === 'doc') {
    return content;
  }
  if (typeof content === 'string' && content.trim()) {
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === 'object' && parsed.type === 'doc') return parsed;
    } catch {
      return '<p></p>';
    }
  }
  return '<p></p>';
}

function ToolbarButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="document-editor-toolbar-button"
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export default function DocumentPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [document, setDocument] = useState<DocumentRow | null>(null);
  const [title, setTitle] = useState('Untitled Document');
  const titleRef = useRef('Untitled Document');
  const [status, setStatus] = useState('Loading...');
  const [error, setError] = useState('');
  const [wordCountOpen, setWordCountOpen] = useState(false);
  const [wordCount, setWordCount] = useState({ pages: 1, words: 0, characters: 0, charactersNoSpaces: 0 });
  const readyRef = useRef(false);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      StyledText,
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Image,
      Link.configure({ openOnClick: false, autolink: true }),
      Color.configure({ types: ['textStyle'] }),
      Highlight.configure({ multicolor: true }),
      Indent,
    ],
    content: '<p></p>',
    onUpdate: () => setStatus('Unsaved changes'),
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
    editor.commands.setContent(getInitialContent(document.content), { emitUpdate: false });
  }, [editor, document]);

  const save = async () => {
    if (!editor || !document) return;
    setStatus('Saving...');
    try {
      await saveDocument(document.id, titleRef.current, editor.getJSON());
      setStatus('Saved');
    } catch (saveError) {
      setStatus('Error');
      setError(saveError instanceof Error ? saveError.message : 'Could not save document.');
    }
  };

  useEffect(() => {
    if (!editor || !document) return;
    const timer = window.setInterval(() => void save(), 30000);
    return () => window.clearInterval(timer);
  }, [editor, document]);

  const updateWordCount = () => {
    if (!editor) return;
    const text = editor.getText();
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const characters = text.length;
    const charactersNoSpaces = text.replace(/\s/g, '').length;
    const pages = Math.max(1, Math.ceil(characters / 3000));
    setWordCount({ pages, words, characters, charactersNoSpaces });
  };

  useEffect(() => {
    if (!editor) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        updateWordCount();
        setWordCountOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editor]);

  const insertLink = () => {
    const url = window.prompt('Enter a URL');
    if (!url) return;
    editor?.chain().focus().setLink({ href: url }).run();
  };

  const insertImage = () => {
    const url = window.prompt('Enter an image URL');
    if (!url) return;
    editor?.chain().focus().setImage({ src: url }).run();
  };

  const changeFontFamily = (family: string) => {
    if (!FONT_FAMILIES.includes(family)) return;
    editor?.chain().focus().setMark('textStyle', { fontFamily: family }).run();
  };

  const changeFontSize = (value: string) => {
    const size = Number(value);
    if (!FONT_SIZE_SET.has(size)) return;
    editor?.chain().focus().setMark('textStyle', { fontSize: size }).run();
  };

  const changeIndent = (delta: number) => {
    if (!editor) return;
    const current = Number(editor.getAttributes('indent').indent || 0);
    const next = Math.max(0, Math.min(8, current + delta));
    editor.chain().focus().setMark('indent', { indent: next }).run();
  };

  if (status === 'Error' && !document) {
    return (
      <main className="document-editor-error">
        <div>
          <p>{error || 'Could not open this document.'}</p>
          <button type="button" className="document-editor-button" onClick={() => window.location.assign('/files')}>
            Back to Files
          </button>
        </div>
      </main>
    );
  }

  if (!editor || !document) return <main className="document-editor-loading">Loading document...</main>;

  return (
    <main className="document-editor-page">
      <header className="document-editor-header">
        <button type="button" className="document-editor-button" onClick={() => void save().then(() => window.location.assign('/files'))}>
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
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
        <span className="document-editor-status">{status}</span>
      </header>

      <div className="document-editor-toolbar" role="toolbar" aria-label="Text formatting">
        <select
          className="document-editor-select"
          aria-label="Font family"
          defaultValue="Arial"
          onChange={(event) => changeFontFamily(event.target.value)}
        >
          {FONT_FAMILIES.map((family) => <option key={family} value={family}>{family}</option>)}
        </select>

        <input
          className="document-editor-font-size"
          aria-label="Font size"
          type="number"
          min="8"
          max="96"
          list="document-font-sizes"
          defaultValue="16"
          onChange={(event) => changeFontSize(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') changeFontSize(event.currentTarget.value);
          }}
        />
        <datalist id="document-font-sizes">
          {FONT_SIZES.map((size) => <option key={size} value={size} />)}
        </datalist>

        <span className="document-editor-separator" />

        <ToolbarButton label="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><strong>B</strong></ToolbarButton>
        <ToolbarButton label="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><em>I</em></ToolbarButton>
        <ToolbarButton label="Underline" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}><u>U</u></ToolbarButton>
        <ToolbarButton label="Strikethrough" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}><s>S</s></ToolbarButton>

        <span className="document-editor-separator" />

        <label className="document-editor-color-control" title="Text color">
          <span>A</span>
          <input type="color" aria-label="Text color" defaultValue="#000000" onChange={(event) => editor.chain().focus().setColor(event.target.value).run()} />
        </label>
        <label className="document-editor-color-control" title="Highlight color">
          <span>H</span>
          <input type="color" aria-label="Highlight color" defaultValue="#fff59d" onChange={(event) => editor.chain().focus().toggleHighlight({ color: event.target.value }).run()} />
        </label>

        <span className="document-editor-separator" />

        <ToolbarButton label="Align left" active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()}>L</ToolbarButton>
        <ToolbarButton label="Align center" active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()}>C</ToolbarButton>
        <ToolbarButton label="Align right" active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()}>R</ToolbarButton>
        <ToolbarButton label="Justify" active={editor.isActive({ textAlign: 'justify' })} onClick={() => editor.chain().focus().setTextAlign('justify').run()}>J</ToolbarButton>

        <span className="document-editor-separator" />

        <ToolbarButton label="Bullet list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>•</ToolbarButton>
        <ToolbarButton label="Numbered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1.</ToolbarButton>
        <ToolbarButton label="Indent" onClick={() => changeIndent(1)}>→</ToolbarButton>
        <ToolbarButton label="Outdent" onClick={() => changeIndent(-1)}>←</ToolbarButton>

        <span className="document-editor-separator" />

        <ToolbarButton label="Insert link" onClick={insertLink}>🔗</ToolbarButton>
        <ToolbarButton label="Insert image" onClick={insertImage}>▧</ToolbarButton>

        <span className="document-editor-separator" />

        <ToolbarButton label="Undo" onClick={() => editor.chain().focus().undo().run()}>↶</ToolbarButton>
        <ToolbarButton label="Redo" onClick={() => editor.chain().focus().redo().run()}>↷</ToolbarButton>
      </div>

      <section className="document-editor-workspace">
        <div className="document-editor-paper">
          <EditorContent editor={editor} />
        </div>
      </section>

      {wordCountOpen && (
        <div className="document-word-count-overlay" role="dialog" aria-modal="true" aria-labelledby="document-word-count-title">
          <div className="document-word-count-modal">
            <h2 id="document-word-count-title">Word Count</h2>
            <div className="document-word-count-row"><span>Pages</span><strong>{wordCount.pages}</strong></div>
            <div className="document-word-count-row"><span>Words</span><strong>{wordCount.words}</strong></div>
            <div className="document-word-count-row"><span>Characters</span><strong>{wordCount.characters}</strong></div>
            <div className="document-word-count-row"><span>Characters excluding spaces</span><strong>{wordCount.charactersNoSpaces}</strong></div>
            <div className="document-word-count-actions">
              <button type="button" onClick={() => setWordCountOpen(false)}>Cancel</button>
              <button type="button" onClick={() => setWordCountOpen(false)}>OK</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
