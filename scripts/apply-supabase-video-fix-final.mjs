import { readFile, writeFile } from 'node:fs/promises';
const appPath='artifacts/study-kit/src/App.tsx';
let app=await readFile(appPath,'utf8');
if(!app.includes("import * as tus from 'tus-js-client';")) app=app.replace("import { ErrorBoundary } from '@/components/error-boundary';","import * as tus from 'tus-js-client';\nimport { ErrorBoundary } from '@/components/error-boundary';");
app=app.replace("import { getCurrentUser, getStoredUser, signOut, type AuthUser } from '@/lib/auth';","import { getCurrentUser, getStoredUser, getAccessToken, signOut, type AuthUser } from '@/lib/auth';");
const s=app.indexOf('        if (videoFile) {');
const e=app.indexOf('        } else {\n          transcript = await transcribeVideo',s);
if(s<0||e<0) throw new Error('Could not locate videoFile branch');
const block=`        if (videoFile) {
          const accessToken=getAccessToken();
          const supabaseUrl=(import.meta.env.VITE_SUPABASE_URL||'').replace(/\\/$/,'');
          const anonKey=import.meta.env.VITE_SUPABASE_ANON_KEY||'';
          const projectRef=supabaseUrl.match(/^https?:\\/\\/([a-z0-9]+)\\.supabase\\.co$/i)?.[1];
          if(!accessToken||!projectRef||!anonKey) throw new Error('Supabase video upload is not configured.');
          const safeName=videoFile.name.replace(/[^a-zA-Z0-9._-]+/g,'_');
          const userId=getStoredUser()?.id||'user';
          const objectName=\`\${userId}/\${Date.now()}-\${safeName}\`;
          const contentType=videoFile.type||'video/mp4';
          setError('Uploading video… 0%');
          const publicUrl=await new Promise<string>((resolve,reject)=>{
            const upload=new tus.Upload(videoFile,{
              endpoint: \`https://\${projectRef}.storage.supabase.co/storage/v1/upload/resumable\`,
              retryDelays:[0,3000,5000,10000,20000], chunkSize:6*1024*1024,
              headers:{authorization:\`Bearer \${accessToken}\`,apikey:anonKey},
              metadata:{bucketName:'video-uploads',objectName,contentType,cacheControl:'3600'},
              onError:error=>reject(new Error(\`Supabase upload failed: \${error.message}\`)),
              onProgress:(uploaded,total)=>setError(\`Uploading video… \${Math.round(uploaded/total*100)}%\`),
              onSuccess:()=>resolve(\`https://\${projectRef}.supabase.co/storage/v1/object/public/video-uploads/\${objectName.split('/').map(encodeURIComponent).join('/')}\`)
            });
            upload.findPreviousUploads().then(previous=>{if(previous.length) upload.resumeFromPreviousUpload(previous[0]); upload.start();}).catch(reject);
          });
          setError('Video uploaded. Transcribing with Groq…');
          const response=await fetch('/api/transcribe-video-upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:publicUrl,fileName:videoFile.name,mimeType:contentType})});
          const payload=await response.json().catch(()=>null) as {error?:string;text?:string;title?:string}|null;
          if(!response.ok) throw new Error(payload?.error||\`Transcription failed (\${response.status}).\`);
          transcript=payload as {text:string;title:string}; setError('');
`;
app=app.slice(0,s)+block+app.slice(e);
await writeFile(appPath,app);
const authPath='artifacts/study-kit/src/lib/auth.ts';
let auth=await readFile(authPath,'utf8');
if(!auth.includes('export function getAccessToken()')){auth=auth.replace('export function getStoredUser(): AuthUser | null {','export function getAccessToken(): string | null {\n  return readSession()?.access_token || null;\n}\n\nexport function getStoredUser(): AuthUser | null {');await writeFile(authPath,auth);}
console.log('Applied final Supabase video upload patch');
