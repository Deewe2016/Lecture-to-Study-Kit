import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import { Decoration, Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
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
const PAGE_WIDTH=816, PAGE_HEIGHT=1056, PAGE_MARGIN=96, PAGE_GAP=32, PAGE_CONTENT_HEIGHT=864, PAGE_STEP=1088;

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
function documentStats(editor:Editor){const text=editor.getText();const trimmed=text.trim();const words=trimmed?trimmed.split(/\s+/).length:0;const characters=text.length;const charactersNoSpaces=text.replace(/\s/g,'').length;const pages=Math.max(1,Math.ceil(Math.max(editor.view.dom.scrollHeight,PAGE_CONTENT_HEIGHT)/PAGE_STEP));return{words,characters,charactersNoSpaces,pages};}

const Pagination=Extension.create({
  name:'pagination',
  addProseMirrorPlugins(){
    const key=new PluginKey('flexusPagination');
    return [new Plugin({
      key,
      state:{init:()=>({breaks:[] as {pos:number;gap:number}[]}),apply:(tr,prev)=>tr.getMeta(key)?.breaks?{breaks:tr.getMeta(key).breaks}:prev},
      props:{decorations(state){
        const breaks=key.getState(state)?.breaks||[];
        return breaks.map((item:{pos:number;gap:number})=>{
          const node=state.doc.nodeAt(item.pos);
          return node?Decoration.Node(item.pos,item.pos+node.nodeSize,{style:'margin-top:'+item.gap+'px'}):null;
        }).filter(Boolean) as any;
      }},
      view(view){
        let raf=0;
        const measure=()=>{
          cancelAnimationFrame(raf);
          raf=requestAnimationFrame(()=>{
            const root=view.dom,rootRect=root.getBoundingClientRect(),next:{pos:number;gap:number}[]=[];
            let pageIndex=0,pageEnd=PAGE_CONTENT_HEIGHT;
            view.state.doc.forEach((node,pos)=>{
              const dom=view.nodeDOM(pos);
              if(!(dom instanceof HTMLElement))return;
              const rect=dom.getBoundingClientRect();
              const top=rect.top-rootRect.top,bottom=rect.bottom-rootRect.top;
              if(bottom>pageEnd+0.5){
                const nextPageStart=(pageIndex+1)*PAGE_STEP;
                next.push({pos,gap:Math.max(0,nextPageStart-top)});
                pageIndex+=1;
                pageEnd=pageIndex*PAGE_STEP+PAGE_CONTENT_HEIGHT;
              }
            });
            const prev=key.getState(view.state)?.breaks||[];
            if(next.length!==prev.length||next.some((item,i)=>item.pos!==prev[i]?.pos||Math.abs(item.gap-(prev[i]?.gap||0))>0.5))view.dispatch(view.state.tr.setMeta(key,{breaks:next}));
          });
        };
        measure();
        return {update:measure,destroy(){cancelAnimationFrame(raf)}};
      },
    })];
  },
});const Indent=Extension.create({
  name:'indent',
  addGlobalAttributes(){return[{types:['paragraph','heading','listItem'],attributes:{indent:{default:0,parseHTML:el=>Number(el.getAttribute('data-indent')||0),renderHTML:a=>{const n=Number(a.indent||0);return n?{'data-indent':String(n),style:'margin-left:'+n*32+'px'}:{}}}}}];},
  addCommands(){return{
    increaseIndent:()=>({state,tr})=>{let changed=false;state.doc.nodesBetween(state.selection.from,state.selection.to,(node,pos)=>{if(!['paragraph','heading','listItem'].includes(node.type.name))return;const n=Math.min(8,Number(node.attrs.indent||0)+1);if(n!==Number(node.attrs.indent||0)){tr.setNodeMarkup(pos,undefined,{...node.attrs,indent:n});changed=true;}});return changed;},
    decreaseIndent:()=>({state,tr})=>{let changed=false;state.doc.nodesBetween(state.selection.from,state.selection.to,(node,pos)=>{if(!['paragraph','heading','listItem'].includes(node.type.name))return;const n=Math.max(0,Number(node.attrs.indent||0)-1);if(n!==Number(node.attrs.indent||0)){tr.setNodeMarkup(pos,undefined,{...node.attrs,indent:n});changed=true;}});return changed;}
  };},
});
const DraggableImage=Image.extend({draggable:true})      .document-page{background:#52525b}
      .document-pages{position:relative;width:816px;margin:0 auto}
      .document-paper-bg{position:relative;width:816px;height:1056px;margin-bottom:32px;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.28)}
      .document-editor-layer{position:absolute;top:0;left:0;width:816px;box-sizing:border-box;padding:96px}
      .document-editor-layer .ProseMirror{box-sizing:border-box;width:624px;min-height:864px;padding:0;background:transparent;outline:none;font-family:Arial,sans-serif;font-size:16px;line-height:1.7}
      .document-editor-layer .ProseMirror p,.document-editor-layer .ProseMirror h1,.document-editor-layer .ProseMirror h2,.document-editor-layer .ProseMirror h3,.document-editor-layer .ProseMirror h4,.document-editor-layer .ProseMirror h5,.document-editor-layer .ProseMirror h6{margin:0 0 .75em}
      .document-editor-layer .ProseMirror ul,.document-editor-layer .ProseMirror ol{padding-left:1.5rem}.document-editor-layer .ProseMirror a{color:#2563eb;text-decoration:underline}.document-editor-layer .ProseMirror img{max-width:100%}
      .document-editor-layer .ProseMirror-selectednode{outline:2px solid #3b82f6;outline-offset:2px}.document-toolbar button{display:inline-flex;align-items:center;justify-content:center;height:30px;min-width:30px;border-radius:5px}.document-toolbar button:hover{background:#f4f4f5}.document-toolbar button[data-active="true"]{background:#e4e4e7}
      .document-toolbar select,.document-toolbar input{height:30px;border:1px solid #d4d4d8;border-radius:5px;background:#fff;color:#18181b;padding:0 6px;font-size:12px}.document-toolbar input[type=color]{width:34px;padding:3px}
      .document-word-count-modal{width:380px;border-radius:10px;background:#fff;box-shadow:0 20px 60px rgba(0,0,0,.35);padding:24px}
      .document-word-count-modal h2{font-size:20px;font-weight:500;margin:0 0 20px}
      .document-word-count-row{display:flex;justify-content:space-between;margin:9px 0;font-size:14px;color:#27272a}
    <div className="document-page relative min-h-0 flex-1 overflow-auto px-4 py-8 sm:px-8">
      <div className="document-pages" style={{minHeight:Math.max(PAGE_HEIGHT,stats.pages*PAGE_STEP-PAGE_GAP)}}>
        {Array.from({length:stats.pages},(_,i)=><div key={i} className="document-paper-bg"><div className="absolute bottom-5 left-0 right-0 text-center text-[11px] text-zinc-500">{i+1}</div></div>)}
        <div className="document-editor-layer"><EditorContent editor={editor}/></div>
      </div>
      {wordCountWhileTyping&&<div className="fixed bottom-3 left-3 rounded bg-white/95 px-2 py-1 text-[11px] text-zinc-600 shadow">{stats.words} {stats.words===1?'word':'words'}</div>}
    </div>
;