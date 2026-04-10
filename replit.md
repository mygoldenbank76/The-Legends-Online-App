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

## DB Schema

- `users` — id, username, display_name, password_hash, avatar, is_online, last_seen
- `conversations` — id, type, name
- `conversation_participants` — id, conversation_id, user_id, last_read_at
- `messages` — id, conversation_id, sender_id, content, image_url, link_preview (JSONB)
- `reactions` — id, message_id, user_id, emoji

## Test Users

- alice / password123
- bob / password123
