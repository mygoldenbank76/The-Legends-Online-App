/**
 * BackgroundLoader — runs invisibly after login and silently preloads the entire platform.
 *
 * Strategy (mirrors Telegram / WhatsApp behaviour):
 * 1. Most-recent 5 conversations → fetched immediately (already handled by conversation-list)
 * 2. All remaining conversations → fetched in the background with 600ms stagger
 * 3. Every message fetched → all its media (images, album, link-previews) queued for preload
 * 4. Spotify embeds → pre-warmed in the iframe pool so they load instantly later
 *
 * The React Query cache is persisted to IndexedDB (see idb-persister.ts), so on next open
 * all this data is restored instantly from disk before any network request fires.
 */

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListConversations,
  getListMessagesQueryKey,
  listMessages,
} from '@workspace/api-client-react';
import { useAuth } from '@/lib/auth-context';
import { preloadMedia } from '@/lib/media-cache';
import { prewarmIframe } from '@/lib/iframe-pool';

const SPOTIFY_ALLOW = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture';

function preloadMessagesMedia(messages: unknown[]) {
  for (const m of messages as any[]) {
    // Single image / video thumbnail
    if (m.imageUrl && !/\.(mp4|webm|mov|avi|mkv)$/i.test(m.imageUrl)) {
      preloadMedia(m.imageUrl);
    }
    // Album
    if (Array.isArray(m.mediaAlbum)) {
      for (const url of m.mediaAlbum) {
        if (!/\.(mp4|webm|mov|avi|mkv)$/i.test(url)) preloadMedia(url);
      }
    }
    // Reply thumbnail
    if (m.replyTo?.imageUrl && !/\.(mp4|webm|mov|avi|mkv)$/i.test(m.replyTo.imageUrl)) {
      preloadMedia(m.replyTo.imageUrl);
    }
    // Link preview
    if (m.linkPreview?.image) preloadMedia(m.linkPreview.image);
    if (m.linkPreview?.embedUrl && m.linkPreview.platform === 'spotify') {
      prewarmIframe(m.linkPreview.embedUrl, { allow: SPOTIFY_ALLOW, height: '152' });
    }
  }
}

export function BackgroundLoader() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: conversations = [] } = useListConversations();
  const bootstrappedRef = useRef(false);

  useEffect(() => {
    if (!user || conversations.length === 0) return;
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;

    // Preload avatars for DMs immediately
    for (const conv of conversations) {
      if ((conv as any).otherUser?.avatar) {
        preloadMedia((conv as any).otherUser.avatar);
      }
      const lm = (conv as any).lastMessage;
      if (lm?.imageUrl && !/\.(mp4|webm|mov|avi|mkv)$/i.test(lm.imageUrl)) {
        preloadMedia(lm.imageUrl);
      }
    }

    // For each conversation, fetch its full message list in background
    // Skip the first 5 (already handled by conversation-list prefetch at idx*300ms)
    conversations.forEach((conv, idx) => {
      const key   = getListMessagesQueryKey(conv.id);
      const state = queryClient.getQueryState(key);

      // If data already in cache (restored from IDB or already prefetched), just preload media
      if (state?.data) {
        preloadMessagesMedia(state.data as unknown[]);
        return;
      }

      // First 5: slight delay (the conv-list prefetch may still be in-flight)
      // Rest: 600ms stagger to avoid hammering the server
      const delay = idx < 5 ? 800 : 800 + (idx - 5) * 600;

      setTimeout(async () => {
        try {
          // Re-check: data may have arrived while we were waiting
          const fresh = queryClient.getQueryState(key);
          if (fresh?.data) {
            preloadMessagesMedia(fresh.data as unknown[]);
            return;
          }

          const msgs = await queryClient.fetchQuery({
            queryKey: key,
            queryFn: () => listMessages(conv.id),
            staleTime: Infinity,
          });

          preloadMessagesMedia(msgs as unknown[]);
        } catch {
          // Network error — silently skip, will retry next session
        }
      }, delay);
    });
  // Re-run only when a new conversation appears (length change)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, conversations.length]);

  return null;
}
