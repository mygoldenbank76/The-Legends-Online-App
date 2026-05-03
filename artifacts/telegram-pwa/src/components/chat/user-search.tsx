import { useState, useRef } from "react";
import { useAuth } from "@/lib/auth-context";
import { useSearchUsers, useCreateConversation, getSearchUsersQueryKey } from "@workspace/api-client-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Search, Loader2 } from "lucide-react";
import { useDebounce } from "@/hooks/use-debounce";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type UserSearchProps = {
  onSelectUser: (userId: number) => void;
};

export function UserSearch({ onSelectUser }: UserSearchProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  
  const { data: users, isLoading } = useSearchUsers({ q: debouncedSearch }, {
    query: {
      queryKey: getSearchUsersQueryKey({ q: debouncedSearch }),
      enabled: debouncedSearch.length > 0,
    }
  });

  const createConv = useCreateConversation();

  const handleSelect = async (userId: number) => {
    try {
      const conv = await createConv.mutateAsync({ data: { userId } });
      setOpen(false);
      setSearch("");
      onSelectUser(conv.id);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search users to chat"
            className="w-full pl-9 bg-sidebar-accent border-none rounded-full h-10 placeholder:text-muted-foreground text-sm focus-visible:ring-1 focus-visible:ring-primary"
            onClick={() => setOpen(true)}
          />
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <div className="max-h-80 overflow-y-auto">
          {isLoading && (
            <div className="p-4 flex justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {!isLoading && users?.length === 0 && debouncedSearch && (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No users found
            </div>
          )}
          {!isLoading && users?.map((u) => (
            <div
              key={u.id}
              className="flex items-center gap-3 p-3 hover:bg-muted cursor-pointer"
              onClick={() => handleSelect(u.id)}
            >
              <Avatar className="w-10 h-10">
                <AvatarImage src={u.avatar || ""} />
                <AvatarFallback>{u.displayName.substring(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium leading-none mb-1">{u.displayName}</p>
                <p className="text-xs text-muted-foreground truncate">@{u.username}</p>
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
