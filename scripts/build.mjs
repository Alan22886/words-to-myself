import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
for (const path of ['index.html','app.js','config.js','style.css','sw.js','manifest.webmanifest','icon.svg']) await copyFile(path, 'dist/'+path);
