# WhisperDash

Self-hosted audio transcription dashboard. Upload audio or video in the browser, get back a timestamped transcript — powered by an [mlx-whisper-asr](https://github.com/ml-explore) backend.

## Features

- Drag-and-drop upload (audio + video files — mp3, wav, m4a, flac, ogg, mp4, mov, mkv…)
- Transcribe or translate-to-English, auto language detection
- Word-level timestamps
- Live job queue with status badges (pending / processing / done / failed)
- In-app transcript viewer with segment timestamps (toggleable)
- Downloads: **TXT, SRT, VTT, JSON**
- Persistent job history (survives restarts; interrupted jobs re-queue)
- Sequential processing queue — one Whisper call at a time

## Quick start (Docker)

```bash
git clone https://github.com/The-Code-Labz/whisper-dash.git
cd whisper-dash
cp .env.example .env   # set WHISPER_URL if different
docker compose up -d --build
```

Open http://localhost:4300

## Configuration

| Variable | Default | Description |
|---|---|---|
| `WHISPER_URL` | `http://100.89.249.230:9000` | Base URL of the mlx-whisper-asr server |
| `PORT` | `4300` | Web UI / API port |
| `MAX_UPLOAD_MB` | `500` | Max upload size |

## Whisper backend contract

Expects an mlx-whisper-asr compatible server:

- `GET /health` → `{"status":"ok"}`
- `POST /asr?task=transcribe|translate&language=…&output=json&word_timestamps=true` (multipart `audio_file`)
  → `{"text": "…", "segments": [{"start", "end", "text", …}], "language": "en"}`

## Dev

```bash
cd backend && npm install && npm start          # :4300
cd frontend && npm install && npm run dev        # :4301 (proxies /api)
```

## API

| Endpoint | Description |
|---|---|
| `GET /api/health` | App + Whisper backend status |
| `POST /api/jobs?filename=…&task=…&language=…&word_timestamps=…` | Upload audio (raw body), queue job |
| `GET /api/jobs` | List jobs |
| `GET /api/jobs/:id` | Job detail + transcript |
| `GET /api/jobs/:id/download?format=txt\|srt\|vtt\|json` | Download transcript |
| `DELETE /api/jobs/:id` | Delete job + transcript |
