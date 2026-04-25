import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useListConversations } from "@workspace/api-client-react";
import { formatDistanceToNow } from "date-fns";
import { fr, enUS, es, ar, pt, de } from 'date-fns/locale';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { UserSearch } from "./user-search";
import { Button } from "@/components/ui/button";
import { usePreferences } from "@/lib/preferences-context";

const dateFnsLocaleMap: Record<string, Locale> = { fr, en: enUS, es, ar, pt, de };

type SidebarProps = {
  activeConversationId?: number;
  onSelectConversation: (id: number) => void;
};

export function Sidebar({ activeConversationId, onSelectConversation }: SidebarProps) {
  const { user, logout } = useAuth();
  const { appLanguage } = usePreferences();
  const { data: conversations = [] } = useListConversations();

  return (
    <div className="w-full h-full flex flex-col bg-sidebar border-r border-sidebar-border">
      <div className="p-3 border-b border-sidebar-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Avatar className="w-10 h-10">
            <AvatarImage src={user?.avatar || ""} />
            <AvatarFallback className="bg-primary text-primary-foreground">{user?.displayName?.substring(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="flex flex-col">
            <span className="text-sm font-medium text-sidebar-foreground leading-tight">{user?.displayName}</span>
            <span className="text-xs text-muted-foreground leading-tight">@{user?.username}</span>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={logout} className="text-muted-foreground hover:text-foreground">
          <LogOut className="w-5 h-5" />
        </Button>
      </div>
      <div className="p-3">
        <UserSearch onSelectUser={onSelectConversation} />
      </div>
      
      <div className="flex-1 overflow-y-auto">
        {conversations.map((conv) => {
          const isGroup = conv.type === "group";
          const title = conv.name || conv.otherUser?.displayName || "Unknown";
          const avatarUrl = isGroup ? undefined : conv.otherUser?.avatar;
          const initials = title.substring(0, 2).toUpperCase();
          const lastMsg = conv.lastMessage;
          const isOnline = !isGroup && conv.otherUser?.isOnline;
          
          return (
            <div
              key={conv.id}
              onClick={() => onSelectConversation(conv.id)}
              className={cn(
                "flex items-center gap-3 p-3 cursor-pointer hover:bg-sidebar-accent transition-colors",
                activeConversationId === conv.id && "bg-sidebar-accent"
              )}
            >
              <div className="relative">
                <Avatar className="w-12 h-12">
                  <AvatarImage src={avatarUrl || ""} />
                  <AvatarFallback className="bg-primary/20 text-primary">{initials}</AvatarFallback>
                </Avatar>
                {isOnline && (
                  <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-sidebar rounded-full"></span>
                )}
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-baseline mb-1">
                  <h3 className="font-medium text-sm truncate pr-2 text-sidebar-foreground">
                    {title}
                  </h3>
                  {lastMsg && (
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDistanceToNow(new Date(lastMsg.createdAt), { addSuffix: false, locale: dateFnsLocaleMap[appLanguage] ?? fr })}
                    </span>
                  )}
                </div>
                <div className="flex justify-between items-center">
                  <p className="text-sm text-muted-foreground truncate">
                    {lastMsg ? (
                      <>
                        {lastMsg.senderId === user?.id && <span className="text-primary mr-1">You:</span>}
                        {lastMsg.content || (lastMsg.imageUrl ? "Photo" : "")}
                      </>
                    ) : (
                      "No messages yet"
                    )}
                  </p>
                  {conv.unreadCount > 0 && (
                    <div className="ml-2 gradient-primary pulse-glow text-white text-xs rounded-full min-w-5 h-5 flex items-center justify-center px-1.5 font-medium">
                      {conv.unreadCount}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}