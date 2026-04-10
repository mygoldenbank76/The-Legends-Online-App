import { useState } from 'react';
import { Sidebar } from '@/components/chat/sidebar';
import { ChatArea } from '@/components/chat/chat-area';
import { useAuth } from '@/lib/auth-context';
import { useIsMobile } from '@/hooks/use-mobile';
import { useUpdateUserStatus } from '@workspace/api-client-react';

export default function Home() {
  const { user } = useAuth();
  const [activeConversationId, setActiveConversationId] = useState<number | undefined>();
  const isMobile = useIsMobile();

  if (!user) return null;

  const showSidebar = !isMobile || !activeConversationId;
  const showChat = !isMobile || activeConversationId;

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-background text-foreground">
      {showSidebar && (
        <div className={`${isMobile ? 'w-full' : 'w-[320px] min-w-[320px]'} h-full flex-shrink-0 border-r border-border relative`}>
          <Sidebar 
            activeConversationId={activeConversationId} 
            onSelectConversation={setActiveConversationId} 
          />
        </div>
      )}
      {showChat && (
        <div className="flex-1 h-full min-w-0 relative bg-background flex flex-col">
          {activeConversationId ? (
            <ChatArea 
              conversationId={activeConversationId} 
              onBack={isMobile ? () => setActiveConversationId(undefined) : undefined} 
            />
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground flex-col gap-4">
              <div className="text-xl font-medium px-4 py-1 rounded-full bg-sidebar/50">Select a chat to start messaging</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}