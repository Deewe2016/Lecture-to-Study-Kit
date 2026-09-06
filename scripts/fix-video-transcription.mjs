import { readFile, writeFile } from 'node:fs/promises';

const appPath = 'artifacts/study-kit/src/App.tsx';
let app = await readFile(appPath, 'utf8');

if (!app.includes("import * as tus from 'tus-js-client';")) {
  const marker = "import * as pdfjsLib from 'pdfjs-dist';";
  if (!app.includes(marker)) throw new Error('App.tsx import marker not found');
  app = app.replace(marker, `${marker}\nimport * as tus from 'tus-js-client';`);
}

const authImport = "import { getCurrentUser, getStoredUser, signOut, type AuthUser } from '@/lib/auth';";
if (app.includes(authImport)) app = app.replace(authImport, "import { getCurrentUser, getStoredUser, getAccessToken, signOut, type AuthUser } from '@/lib/auth';");

const oldBlock = `        if (videoFile) {
          const uploadResponse = await fetch('/api/transcribe-video-upload', {
            method: 'POST',
            headers: { 'Content-Type': videoFile.type || 'application/octet-stream', 'X-File-Name': videoFile.name },
            body: videoFile,
          });
          if (!uploadResponse.ok) {
            const payload = await uploadResponse.json().catch(() => null) as { error?: string } | null;
            throw new Error(payload?.error || 'Could not transcribe this upload.');
          }
          transcript = await uploadResponse.json() as { text: string; title: string };
        } else {`;

if (!app.includes(oldBlock)) throw new Error('Original video upload block not found; no partial edit made.');

const newBlock = `        if (videoFile) {
          const accessToken = getAccessToken();
          const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\\/$/, '');
          const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
          const projectRef = supabaseUrl.match(/^https?:\\/\\/([a-z0-9]+)\\.supabase\\.co$/i)?.[1];
          if (!accessToken || !projectRef || !anonKey) throw new Error('Supabase video upload is not configured.');

          const supportedTypes = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm', 'audio/flac']);
          if (videoFile.type && !supportedTypes.has(videoFile.type)) throw new Error('Unsupported video format. Please use MP4, MOV, or WebM.');

          const safeName = videoFile.name.replace(/[^a-zA-Z0-9._-]+/g, '_');
          const userId = getStoredUser()?.id || 'user';
          const objectName = \`\${userId}/\${Date.now()}-\${safeName}\`;
          const contentType = videoFile.type || 'video/mp4';

          setError('Uploading video… 0%');
          const publicUrl = await new Promise<string>((resolve, reject) => {
            const upload = new tus.Upload(videoFile, {
              endpoint: \`https://\${projectRef}.storage.supabase.co/storage/v1/upload/resumable\`,
              retryDelays: [0, 3000, 5000, 10000, 20000],
              chunkSize: 6 * 1024 * 1024,
              headers: { authorization: \`Bearer \${accessToken}\`, apikey: anonKey },
              metadata: { bucketName: 'video-uploads', objectName, contentType, cacheControl: '3600' },
              onError: (error) => reject(new Error(\`Supabase upload failed: \${error.message}\`)),
              onProgress: (uploaded, total) => setError(\`Uploading video… \${Math.round((uploaded / total) * 100)}%\`),
              onSuccess: () => {
                const encodedPath = objectName.split('/').map(encodeURIComponent).join('/');
                resolve(\`https://\${projectRef}.supabase.co/storage/v1/object/public/video-uploads/\${encodedPath}\`);
              },
            });
            upload.findPreviousUploads().then((previous) => {
              if (previous.length > 0) upload.resumeFromPreviousUpload(previous[0]);
              upload.start();
            }).catch(reject);
          });

          setError('Video uploaded. Transcribing with Groq…');
          const uploadResponse = await fetch('/api/transcribe-video-upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: publicUrl, fileName: videoFile.name, mimeType: contentType }),
          });
          const payload = await uploadResponse.json().catch(() => null) as { error?: string; text?: string; title?: string } | null;
          if (!uploadResponse.ok) throw new Error(payload?.error || \`Transcription failed (HTTP \${uploadResponse.status}).\`);
          transcript = payload as { text: string; title: string };
          setError('');
        } else {`;

app = app.replace(oldBlock, newBlock);
app = app.replace('accept="video/mp4,audio/*,.mp4"', 'accept="video/mp4,video/quicktime,video/webm,audio/*,.mp4,.mov,.webm"');
app = app.replace('Upload MP4 or audio', 'Upload MP4, MOV, WebM, or audio');
await writeFile(appPath, app);
console.log('Video transcription frontend patched successfully.');
