import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import { Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import TextAlign from '@tiptap/extension-text-align';
import FontFamily from '@tiptap/extension-font-family';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import { TextStyle, FontSize } from '@tiptap/extension-text-style';
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, ArrowLeft, Bold, Check, Highlighter, ImagePlus, Italic, Link as LinkIcon, List, ListOrdered, Minus, Plus, Redo2, Save, Strikethrough, Type, Undo2, Underline as UnderlineIcon } from 'lucide-react';
import { getAccessToken, getStoredUser } from '@/lib/auth';

type DocumentRow = { id:string; title:string; content:any; owner_id:string; folder_id:string|null; created_at:string; updated_at:string };
const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const IMAGE_TYPES = new Set(['image/jpeg','image/png','image/gif','image/webp']);
const FONT_SIZES = [5,6,7,8,9,10,11,12,14,16,18,20,24,28,32,36,40,48,56,64,72,96,100];

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    indent: { increaseIndent: () => ReturnType; decreaseIndent: () => ReturnType };
  }
}

async function api<T>(path:string, init:RequestInit={}):Promise<T> {
  const token=getAccessToken();
  if(!token || !supabaseUrl || !anon) throw new Error('Document storage is not configured.');
  const response=await fetch(supabaseUrl+path,{...init,headers:{apikey:anon,Authorization:'Bearer '+token,'Content-Type':'application/json',...(init.headers||{})}});
  const body=await response.text();
  let data:any=null; try{data=body?JSON.parse(body):null;}catch{data=body;}
  if(!response.ok) throw new Error(typeof data==='object'&&data?String(data.message||data.details||'Request failed'):'Request failed');
  return data as T;
}

async function uploadImage(file:File, documentId:string) {
  if(!IMAGE_TYPES.has(file.type)) throw new Error('Please choose a JPG, PNG, GIF, or WebP image.');
  const token=getAccessToken(), user=getStoredUser();
  if(!token||!user?.id||!supabaseUrl||!anon) throw new Error('Image storage is not configured.');
  const ext=file.type==='image/jpeg'?'jpg':file.type.split('/')[1];
  const path=user.id+'/documents/'+documentId+'/'+crypto.randomUUID()+'.'+ext;
  const upload=await fetch(supabaseUrl+'/storage/v1/object/user-files/'+path,{method:'POST',headers:{apikey:anon,Authorization:'Bearer '+token,'Content-Type':file.type,'x-upsert':'false'},body:file});
  if(!upload.ok) throw new Error((await upload.text())||'Could not upload image.');
  const signed=await fetch(supabaseUrl+'/storage/v1/object/sign/user-files/'+path,{method:'POST',headers:{apikey:anon,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({expiresIn:31536000})});
  const data=await signed.json().catch(()=>({}));
  if(!signed.ok||!data?.signedURL) throw new Error(data?.message||'Could not create an image URL.');
  return String(data.signedURL).startsWith('http')?data.signedURL:supabaseUrl+'/storage/v1'+data.signedURL;
}

function esc(s:string){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function markText(text:string,a:any={}) {
  let out=esc(text).replace(/\n/g,'<br>');
  if(a.bold)out='<strong>'+out+'</strong>'; if(a.italic)out='<em>'+out+'</em>'; if(a.underline)out='<u>'+out+'</u>'; if(a.strike)out='<s>'+out+'</s>';
  const styles:string[]=[]; if(a.color)styles.push('color:'+a.color); if(a.background)styles.push('background-color:'+a.background);
  if(a.font)styles.push('font-family:'+a.font); if(a.size)styles.push('font-size:'+String(a.size).replace(/px$/,'')+'px');
  if(styles.length)out='<span style="'+styles.join(';')+'">'+out+'</span>'; if(a.link)out='<a href="'+esc(String(a.link))+'">'+out+'</a>'; return out;
}
function quillToHtml(delta:any){
  if(!Array.isArray(delta?.ops))return '<p></p>'; let html='<p>';
  for(const op of delta.ops){
    if(typeof op.insert==='object'&&op.insert?.image){html+='<img src="'+esc(String(op.insert.image))+'" />';continue;}
    if(typeof op.insert!=='string')continue;
    const parts=op.insert.split('\n'); parts.forEach((part:string,i:number)=>{if(part)html+=markText(part,op.attributes);if(i<parts.length-1)html+='</p><p>';});
  }
  return html+'</p>';
}
function initialContent(content:any){if(!content)return '<p></p>';if(content.type==='doc')return content;if(Array.isArray(content.ops))return quillToHtml(content);if(typeof content==='string')return content;return '<p></p>';}
function wordCount(editor:Editor){const text=editor.getText().trim();return text?text.split(/\s+/).length:0;}

const Indent=Extension.create({
  name:'indent',
  addGlobalAttributes(){return[{types:['paragraph','heading','listItem'],attributes:{indent:{default:0,parseHTML:el=>Number(el.getAttribute('data-indent')||0),renderHTML:a=>{const n=Number(a.indent||0);return n?{'data-indent':String(n),style:'margin-left:'+n*32+'px'}:{}}}}}];},
  addCommands(){return{
    increaseIndent:()=>({state,tr})=>{let changed=false;state.doc.nodesBetween(state.selection.from,state.selection.to,(node,pos)=>{if(!['paragraph','heading','listItem'].includes(node.type.name))return;const n=Math.min(8,Number(node.attrs.indent||0)+1);if(n!==Number(node.attrs.indent||0)){tr.setNodeMarkup(pos,undefined,{...node.attrs,indent:n});changed=true;}});return changed;},
    decreaseIndent:()=>({state,tr})=>{let changed=false;state.doc.nodesBetween(state.selection.from,state.selection.to,(node,pos)=>{if(!['paragraph','heading','listItem'].includes(node.type.name))return;const n=Math.max(0,Number(node.attrs.indent||0)-1);if(n!==Number(node.attrs.indent||0)){tr.setNodeMarkup(pos,undefined,{...node.attrs,indent:n});changed=true;}});return changed;}
  };},
});
const DraggableImage=Image.extend({draggable:true});

export default function DocumentPage({params}:{params:{id:string}}){
  const id=params.id;
  const [document,setDocument]=useState<DocumentRow|null>(null);
  const documentRef=useRef<DocumentRow|null>(null);
  const [title,setTitle]=useState('Untitled Document');
  const titleRef=useRef('Untitled Document');
  const [status,setStatus]=useState<'Loading...'|'Saving...'|'Saved'|'Error'>('Loading...');
  const [savedAt,setSavedAt]=useState('');
  const [words,setWords]=useState(0);
  const [ready,setReady]=useState(false);
  const [fontSize,setFontSize]=useState('16');
  const [fontFamily,setFontFamily]=useState('Arial');
  const fileInput=useRef<HTMLInputElement|null>(null);

  const editor=useEditor({
    immediatelyRender:false,
    extensions:[
      StarterKit,TextStyle,FontSize,FontFamily,Color,Highlight.configure({multicolor:true}),Underline,
      Link.configure({autolink:true,openOnClick:false,defaultProtocol:'https'}),
      TextAlign.configure({types:['heading','paragraph'],alignments:['left','center','right','justify']}),
      Indent,
      DraggableImage.configure({resize:{enabled:true,directions:['top-left','top-right','bottom-left','bottom-right'],minWidth:50,minHeight:50,alwaysPreserveAspectRatio:true},HTMLAttributes:{class:'document-image'}}),
    ],
    content:'<p></p>',
    onUpdate:({editor:e})=>{setWords(wordCount(e));setStatus('Saving...');},
  });

  useEffect(()=>{let cancelled=false;void api<DocumentRow[]>('/rest/v1/documents?id=eq.'+encodeURIComponent(id)+'&select=*').then(rows=>{if(cancelled||!rows[0])throw new Error('Document not found.');const d=rows[0];documentRef.current=d;setDocument(d);titleRef.current=d.title||'Untitled Document';setTitle(titleRef.current);setStatus('Saved');setReady(true);}).catch(()=>{if(!cancelled)setStatus('Error');});return()=>{cancelled=true;};},[id]);
  useEffect(()=>{if(!editor||!ready||!document)return;editor.commands.setContent(initialContent(document.content),{emitUpdate:false});setWords(wordCount(editor));},[editor,ready,document?.id]);

  const save=async()=>{const e=editor,d=documentRef.current;if(!e||!d)return;setStatus('Saving...');try{const updated=await api<DocumentRow[]>('/rest/v1/documents?id=eq.'+encodeURIComponent(d.id)+'&select=*',{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({title:titleRef.current.trim()||'Untitled Document',content:e.getJSON(),updated_at:new Date().toISOString()})});if(updated[0]){documentRef.current=updated[0];setDocument(updated[0]);}setSavedAt(new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}));setStatus('Saved');}catch{setStatus('Error');}};
  useEffect(()=>{if(!ready)return;const timer=window.setInterval(()=>void save(),30000);return()=>window.clearInterval(timer);},[ready,editor,document?.id]);

  const insertFile=async(file:File)=>{if(!editor)return;try{const src=await uploadImage(file,id);editor.chain().focus().setImage({src,alt:file.name}).run();}catch(e){window.alert(e instanceof Error?e.message:'Could not insert image.');}};
  useEffect(()=>{if(!editor)return;const onPaste=(event:ClipboardEvent)=>{const item=Array.from(event.clipboardData?.items||[]).find(i=>IMAGE_TYPES.has(i.type));const file=item?.getAsFile();if(file){event.preventDefault();void insertFile(file);}};editor.view.dom.addEventListener('paste',onPaste);return()=>editor.view.dom.removeEventListener('paste',onPaste);},[editor,id]);

  const imageFromUrl=()=>{const src=window.prompt('Enter an image URL');if(src?.trim())editor?.chain().focus().setImage({src:src.trim()}).run();};
  const link=()=>{if(!editor)return;const old=editor.getAttributes('link').href||'';const href=window.prompt('Enter a URL',old);if(href===null)return;if(href.trim())editor.chain().focus().setLink({href:href.trim()}).run();else editor.chain().focus().unsetLink().run();};
  const setSize=(v:string)=>{const n=Number.parseInt(v,10);if(!Number.isFinite(n)||!editor)return;const size=Math.max(5,Math.min(100,n));setFontSize(String(size));editor.chain().focus().setFontSize(size+'px').run();};
  const setFamily=(v:string)=>{setFontFamily(v);editor?.chain().focus().setFontFamily(v).run();};

  if(status==='Error'&&!document)return <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-zinc-950 text-white"><div className="text-center"><p className="text-lg">Could not open this document.</p><button onClick={()=>window.location.assign('/files')} className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm">Back to Files</button></div></div>;
  if(!editor||!document)return <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-zinc-950 text-white">Loading document…</div>;

  return <div className="fixed inset-0 z-[10000] flex h-[100dvh] w-[100vw] flex-col bg-zinc-900 text-slate-900">
    <style>{`
      .document-page .ProseMirror{box-sizing:border-box;width:816px;min-height:1056px;padding:96px;background:#fff;outline:none;font-family:Arial,sans-serif;font-size:16px;line-height:1.7}
      .document-page .ProseMirror p,.document-page .ProseMirror h1,.document-page .ProseMirror h2,.document-page .ProseMirror h3,.document-page .ProseMirror h4,.document-page .ProseMirror h5,.document-page .ProseMirror h6{margin:0 0 .75em}
      .document-page .ProseMirror ul,.document-page .ProseMirror ol{padding-left:1.5rem}.document-page .ProseMirror a{color:#2563eb;text-decoration:underline}.document-page .ProseMirror img{max-width:100%}
      .document-page .ProseMirror-selectednode{outline:2px solid #3b82f6;outline-offset:2px}.document-toolbar button{display:inline-flex;align-items:center;justify-content:center;height:30px;min-width:30px;border-radius:5px}.document-toolbar button:hover{background:#f4f4f5}.document-toolbar button[data-active="true"]{background:#e4e4e7}
      .document-toolbar select,.document-toolbar input{height:30px;border:1px solid #d4d4d8;border-radius:5px;background:#fff;color:#18181b;padding:0 6px;font-size:12px}.document-toolbar input[type=color]{width:34px;padding:3px}
    `}</style>

    <div className="flex h-14 shrink-0 items-center gap-3 border-b border-white/10 bg-zinc-950 px-4 text-white">
      <button onClick={()=>{void save();window.location.assign('/files')}} className="rounded-lg p-2 hover:bg-white/10" title="Back to Files"><ArrowLeft size={18}/></button>
      <input value={title} onChange={e=>{titleRef.current=e.target.value;setTitle(e.target.value);setStatus('Saving...')}} onBlur={()=>void save()} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();if(e.key==='Escape'){const t=documentRef.current?.title||'Untitled Document';titleRef.current=t;setTitle(t);e.currentTarget.blur();}}} className="h-8 w-full max-w-xl rounded border border-white/15 bg-white/10 px-2 text-sm font-medium text-white outline-none" aria-label="Document title"/>
      <div className="flex items-center gap-2 text-xs text-white/60">{status==='Saved'&&<Check size={14}/>} {status==='Saving...'&&<Save size={14}/>}<span>{status}{status==='Saved'&&savedAt?' '+savedAt:''}</span></div>
      <button onClick={()=>void save()} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs hover:bg-white/10">Save</button>
    </div>

    <div className="document-toolbar flex shrink-0 flex-wrap items-center gap-1 border-b border-zinc-200 bg-white px-3 py-1.5 shadow-sm">
      <select value={fontFamily} onChange={e=>setFamily(e.target.value)} aria-label="Font family"><option>Arial</option><option>Georgia</option><option>Times New Roman</option><option>Courier New</option><option>Verdana</option><option>Trebuchet MS</option><option>system-ui</option></select>
      <input type="number" min="5" max="100" step="1" value={fontSize} list="document-font-sizes" onChange={e=>setFontSize(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();setSize(e.currentTarget.value);e.currentTarget.blur();}else if(e.key==='ArrowUp'||e.key==='ArrowDown')window.setTimeout(()=>setSize(e.currentTarget.value),0)}} onBlur={e=>setSize(e.currentTarget.value)} aria-label="Font size" className="w-16 text-center"/>
      <datalist id="document-font-sizes">{FONT_SIZES.map(n=><option key={n} value={n}/>)}</datalist>
      <span className="mx-1 h-6 w-px bg-zinc-200"/>
      <button onClick={()=>editor.chain().focus().toggleBold().run()} data-active={editor.isActive('bold')} title="Bold"><Bold size={16}/></button>
      <button onClick={()=>editor.chain().focus().toggleItalic().run()} data-active={editor.isActive('italic')} title="Italic"><Italic size={16}/></button>
      <button onClick={()=>editor.chain().focus().toggleUnderline().run()} data-active={editor.isActive('underline')} title="Underline"><UnderlineIcon size={16}/></button>
      <button onClick={()=>editor.chain().focus().toggleStrike().run()} data-active={editor.isActive('strike')} title="Strikethrough"><Strikethrough size={16}/></button>
      <label className="flex h-[30px] items-center gap-1 rounded border border-zinc-300 px-1" title="Text color"><Type size={14}/><input type="color" defaultValue="#000000" onChange={e=>editor.chain().focus().setColor(e.target.value).run()}/></label>
      <label className="flex h-[30px] items-center gap-1 rounded border border-zinc-300 px-1" title="Highlight color"><Highlighter size={14}/><input type="color" defaultValue="#fff59d" onChange={e=>editor.chain().focus().setHighlight({color:e.target.value}).run()}/></label>
      <span className="mx-1 h-6 w-px bg-zinc-200"/>
      <button onClick={()=>editor.chain().focus().setTextAlign('left').run()} title="Align left"><AlignLeft size={16}/></button><button onClick={()=>editor.chain().focus().setTextAlign('center').run()} title="Align center"><AlignCenter size={16}/></button><button onClick={()=>editor.chain().focus().setTextAlign('right').run()} title="Align right"><AlignRight size={16}/></button><button onClick={()=>editor.chain().focus().setTextAlign('justify').run()} title="Justify"><AlignJustify size={16}/></button>
      <button onClick={()=>editor.chain().focus().toggleBulletList().run()} data-active={editor.isActive('bulletList')} title="Bullet list"><List size={16}/></button><button onClick={()=>editor.chain().focus().toggleOrderedList().run()} data-active={editor.isActive('orderedList')} title="Numbered list"><ListOrdered size={16}/></button>
      <button onClick={()=>editor.chain().focus().increaseIndent().run()} title="Indent"><Plus size={16}/></button><button onClick={()=>editor.chain().focus().decreaseIndent().run()} title="Outdent"><Minus size={16}/></button>
      <span className="mx-1 h-6 w-px bg-zinc-200"/>
      <button onClick={link} title="Insert link"><LinkIcon size={16}/></button><button onClick={imageFromUrl} title="Insert image from URL"><ImagePlus size={16}/></button><button onClick={()=>fileInput.current?.click()} title="Upload image"><ImagePlus size={16}/></button>
      <span className="mx-1 h-6 w-px bg-zinc-200"/>
      <button onClick={()=>editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Undo"><Undo2 size={16}/></button><button onClick={()=>editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Redo"><Redo2 size={16}/></button>
      <input ref={fileInput} type="file" accept=".jpg,.jpeg,.png,.gif,.webp,image/jpeg,image/png,image/gif,image/webp" className="hidden" onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void insertFile(f)}}/>
    </div>

    <div className="document-page min-h-0 flex-1 overflow-auto bg-zinc-700 px-4 py-8 sm:px-8"><div className="mx-auto min-h-[1056px] w-[816px] shrink-0 bg-white shadow-xl"><EditorContent editor={editor}/></div></div>
    <div className="flex h-8 shrink-0 items-center justify-end border-t border-black/10 bg-white px-6 text-[11px] text-slate-500">{words} {words===1?'word':'words'}</div>
  </div>;
}
