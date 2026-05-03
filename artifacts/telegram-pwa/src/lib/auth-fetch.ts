import { setAuthTokenGetter } from "@workspace/api-client-react";

export function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('telechat_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Set up the custom fetch wrapper to automatically include the token
setAuthTokenGetter(() => localStorage.getItem('telechat_token'));
