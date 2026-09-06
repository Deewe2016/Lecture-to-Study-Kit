import { readFile, writeFile } from 'node:fs/promises';

const appPath = 'artifacts/study-kit/src/App.tsx';
let text = await readFile(appPath, 'utf8');

if (!text.includes("import * as tus from 'tus-js-client';")) {
  text = text.replace("import * as pdfjsLib from 'pdfjs-dist';", "import * as pdfjsLib from 'pdfjs-dist';\nimport * as tus from 'tus-js-client';");
}

text = text.replace(
  "import { getCurrentUser, getStoredUser, signOut, type AuthUser } from '@/lib/auth';",
  "import { getCurrentUser, getStoredUser, getAccessToken, getSupabaseUploadConfig, signOut, type AuthUser } from '@/lib/auth';"
);

const pattern = /  if \(sourceMode === 'video'\) \{[\s\S]*?    return;\n  \}\n/;
const replacement = `  if (sourceMode === 'video') {
    try {
      let transcript;
      if (videoFile) {
        const accessToken = getAccessToken();
        const storedUser = getStoredUser();
        if (!accessToken || !storedUser) throw new Error('Your session expired. Please sign in again before uploading a video.');

        const { url: supabaseUrl, anonKey } = getSupabaseUploadConfig();
        const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
        const endpoint = \`https://\${projectRef}.storage.supabase.co/storage/v1/upload/resumable\`;
        const safeName = videoFile.name.replace(/[^a-zA-Z0-9._-]+/g, '-');
        const objectName = \`\${storedUser.id}/\${Date.now()}-\${safeName}\`;
        const contentType = videoFile.type || 'video/mp4';

        setStage('generating');
        setError('Uploading video…');

        await new Promise((resolve, reject) => {
          const upload = new tus.Upload(videoFile, {
            endpoint,
            retryDelays: [0, 3000, 5000, 10000, 20000],
            chunkSize: 6 * 1024 * 1024,
            headers: { Authorization: \`Bearer \${accessToken}\`, apikey: anonKey },
            metadata: {
              bucketName: 'video-uploads',
              objectName,
              contentType,
              cacheControl: '3600',
            },
            onError: reject,
            onProgress: (bytesUploaded, bytesTotal) => {
              setError(\`Uploading video… \${Math.round((bytesUploaded / bytesTotal) * 100)}%\`);
            },
            onSuccess: resolve,
          });

          void upload.findPreviousUploads().then((previousUploads) => {
            if (previousUploads.length > 0) upload.resumeFromPreviousUpload(previousUploads[0]);
            upload.start();
          }).catch(reject);
        });

        const publicPath = objectName.split('/').map(encodeURIComponent).join('/');
        const publicUrl = \`\${supabaseUrl}/storage/v1/object/public/video-uploads/\${publicPath}\`;
        setError('Transcribing video…');

        const uploadResponse = await fetch('/api/transcribe-video-upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: publicUrl, fileName: videoFile.name, mimeType: contentType }),
        });
        const payload = await uploadResponse.json().catch(() => null);
        if (!uploadResponse.ok) throw new Error(payload?.error || 'Could not transcribe this upload.');
        transcript = payload;
        setError('');
      } else {
        transcript = await transcribeVideo({ url: videoUrl.trim() || null, fileName: null, fileData: null, mimeType: null });
      }
      generationMaterials = [{ name: transcript.title, kind: 'transcript', text: transcript.text }];
    } catch (transcriptionError) {
      setStage('error');
      setError(transcriptionError instanceof Error ? transcriptionError.message : 'Could not transcribe this video.');
      return;
    }
  }
`;

const match = text.match(pattern);
if (!match) throw new Error('Could not locate the existing video transcription block in App.tsx');
text = text.replace(pattern, replacement);
await writeFile(appPath, text);
console.log('Patched App.tsx');
