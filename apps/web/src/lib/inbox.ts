import type { ConversationDto, MatchRequestDto } from "@offgrid/core";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

/** Requests and chats, refreshed every minute while the app is open, for the header badge and inbox. */
export function useInbox(authed: boolean) {
  const [requests, setRequests] = useState<MatchRequestDto[]>([]);
  const [conversations, setConversations] = useState<ConversationDto[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    if (!authed || !navigator.onLine) return;
    try {
      const [r, c] = await Promise.all([api<MatchRequestDto[]>("/match/requests"), api<ConversationDto[]>("/conversations")]);
      setRequests(r);
      setConversations(c);
      setLoaded(true);
    } catch {
      /* keep what we have */
    }
  }, [authed]);

  useEffect(() => {
    if (!authed) {
      setRequests([]);
      setConversations([]);
      return;
    }
    void refresh();
    const t = setInterval(() => void refresh(), 60_000);
    return () => clearInterval(t);
  }, [authed, refresh]);

  const pendingIncoming = requests.filter((r) => r.direction === "incoming" && r.status === "pending").length;
  const unread = conversations.reduce((n, c) => n + (c.closed ? 0 : c.unread), 0);
  return { requests, conversations, loaded, badge: pendingIncoming + unread, refresh };
}
