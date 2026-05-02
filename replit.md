# TeleChat - Real-time Messaging PWA

## Overview

A full-stack, real-time messaging Progressive Web App inspired by Telegram. Built with React, Tailwind CSS, Node.js/Express, PostgreSQL (Drizzle ORM), and Socket.io.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5 + Socket.io
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite + Tailwind CSS (dark Telegram theme)
- **Auth**: JWT tokens (stored in localStorage)
- **Real-time**: Socket.io

## Features

- **Authentication**: Username/password register & login with JWT
- **Two-column layout**: Sidebar with conversation list + chat area (mobile-first responsive)
- **Dark Telegram theme**: Charcoal/blue color palette by default
- **Real-time messaging**: Socket.io instant messaging with live updates
- **Message reactions**: Right-click (web) or long-press (mobile) to add emoji reactions, saved in DB
- **Emoji picker**: In the message input bar
- **Image uploads**: Upload images directly in conversations
- **Link previews**: Auto-fetched for URLs in messages
- **Unread badges**: Per-conversation unread message counts
- **Online/Last seen status**: Green dot + last seen timestamp
- **PWA**: manifest.json + service worker for home screen installation

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Artifacts

- `artifacts/telegram-pwa` — React Vite frontend (previewPath: `/`)
- `artifacts/api-server` — Express API server (previewPath: `/api`, also `/socket.io`)

## Native Android packaging (Capacitor)

The app ships in 3 forms, all from the same codebase:

1. **Web PWA** at `https://thelegendsonline.social` (live)
2. **TWA APK** at `/downloads/legends.apk` (legacy — Chrome wrapper, shares browser session)
3. **Native APK** built by GitHub Actions (Capacitor WebView wrapper, isolated storage, no URL bar)

### Capacitor setup

- Config: `artifacts/telegram-pwa/capacitor.config.ts`
- Package id: `social.thelegendsonline.app` (different from TWA `social.thelegendsonline.twa` so both can coexist)
- Mode: `server.url` points to `https://thelegendsonline.social` → APK is a thin wrapper, web bundle stays small, all updates are live
- Android project: `artifacts/telegram-pwa/android/` (committed except `.gradle/`, `app/build/`, generated assets — see `.gitignore`)
- Plugins: `@capacitor/app`, `@capacitor/splash-screen`, `@capacitor/status-bar`

### Build pipeline

`.github/workflows/build-android-apk.yml` runs on every push touching `artifacts/telegram-pwa/**` or the workflow itself:

1. Setup pnpm + Node 20 + Java 21 + Android SDK 35
2. Cache `~/.android/debug.keystore` so APK signature is stable across runs (users can update in-place)
3. `pnpm install` → `pnpm --filter @workspace/telegram-pwa run build` → `npx cap sync android`
4. `./gradlew assembleDebug` → output APK
5. Publishes to GitHub release tagged `native-latest` as asset `legends.apk` (replaces the existing release every build)

### Hooking the install page to GitHub releases

In `src/pages/install-apk.tsx`, set `GITHUB_REPO = "owner/repo"` once the workflow has produced the first release. The page calls `https://api.github.com/repos/{REPO}/releases/tags/native-latest` and serves the asset URL. Until set, the page falls back to the in-repo TWA APK at `/downloads/legends.apk`.

### One-time setup for the user

1. In Replit, open the **Version Control** pane and connect this project to a GitHub repo (push the `main` branch)
2. Wait ~10 minutes for the first GitHub Actions run to complete
3. Tell the agent (me) the GitHub repo URL so I can fill in `GITHUB_REPO` in `install-apk.tsx`
4. Republish — `/install-apk` now serves the native APK

## DB Schema

- `users` — id, username, display_name, password_hash, avatar, is_online, last_seen
- `conversations` — id, type, name
- `conversation_participants` — id, conversation_id, user_id, last_read_at
- `messages` — id, conversation_id, sender_id, content, image_url, link_preview (JSONB)
- `reactions` — id, message_id, user_id, emoji

## Test Users

- alice / password123
- bob / password123
