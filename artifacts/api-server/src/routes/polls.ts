import { Router, type IRouter } from "express";
import { db, pollsTable, pollOptionsTable, pollVotesTable, usersTable, messagesTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireAuth, isConversationMember } from "../lib/auth";
import { io } from "../app";

const router: IRouter = Router();

export async function buildPoll(pollId: number, requestingUserId?: number) {
  const [poll] = await db.select().from(pollsTable).where(eq(pollsTable.id, pollId));
  if (!poll) return null;

  const options = await db.select().from(pollOptionsTable)
    .where(eq(pollOptionsTable.pollId, pollId))
    .orderBy(pollOptionsTable.sortOrder);

  const votes = await db.select().from(pollVotesTable)
    .where(eq(pollVotesTable.pollId, pollId));

  const totalVotes = votes.length;
  const userVotedOptionIds = requestingUserId
    ? votes.filter(v => v.userId === requestingUserId).map(v => v.optionId)
    : [];

  const optionsWithVotes = options.map(opt => {
    const optVotes = votes.filter(v => v.optionId === opt.id);
    const percentage = totalVotes > 0 ? Math.round((optVotes.length / totalVotes) * 100) : 0;
    return {
      id: opt.id,
      text: opt.text,
      sortOrder: opt.sortOrder,
      voteCount: optVotes.length,
      percentage,
      voters: poll.isAnonymous ? [] : optVotes.map(v => v.userId),
    };
  });

  return {
    id: poll.id,
    question: poll.question,
    isAnonymous: poll.isAnonymous,
    isMultipleChoice: poll.isMultipleChoice,
    isQuiz: poll.isQuiz,
    totalVotes,
    userVotedOptionIds,
    options: optionsWithVotes,
    createdAt: poll.createdAt.toISOString(),
  };
}

// POST /polls/:pollId/vote
router.post("/polls/:pollId/vote", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
  const pollId = parseInt(req.params.pollId as string, 10);
  if (isNaN(pollId)) { res.status(400).json({ error: "Invalid poll ID" }); return; }

  const { optionIds } = req.body as { optionIds: number[] };

  const [poll] = await db.select().from(pollsTable).where(eq(pollsTable.id, pollId));
  if (!poll) { res.status(404).json({ error: "Poll not found" }); return; }

  // SECURITY: only participants of the conversation hosting the poll
  // may vote. Without this, any authenticated user could vote on any
  // poll by guessing pollId.
  const [voteMsg] = await db.select({ conversationId: messagesTable.conversationId })
    .from(messagesTable).where(eq(messagesTable.pollId, pollId));
  if (!voteMsg || !(await isConversationMember(userId, voteMsg.conversationId))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // Remove existing votes
  await db.delete(pollVotesTable).where(and(
    eq(pollVotesTable.pollId, pollId),
    eq(pollVotesTable.userId, userId)
  ));

  // Insert new votes (if any)
  if (Array.isArray(optionIds) && optionIds.length > 0) {
    const voteIds = poll.isMultipleChoice ? optionIds : [optionIds[0]];
    await db.insert(pollVotesTable).values(
      voteIds.map(optionId => ({ pollId, optionId, userId }))
    );
  }

  const updatedPoll = await buildPoll(pollId, userId);

  // Find the message that contains this poll to emit to the conversation room
  const [msg] = await db.select().from(messagesTable).where(eq(messagesTable.pollId, pollId));
  if (msg) {
    // Build a poll update without user-specific voted IDs (for broadcast)
    const broadcastPoll = await buildPoll(pollId);
    io.to(`conversation:${msg.conversationId}`).emit("poll_updated", {
      messageId: msg.id,
      conversationId: msg.conversationId,
      poll: broadcastPoll,
    });
  }

  res.json(updatedPoll);
});

// GET /polls/:pollId/votes — get voter details (non-anonymous)
router.get("/polls/:pollId/votes", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
  const pollId = parseInt(req.params.pollId as string, 10);
  if (isNaN(pollId)) { res.status(400).json({ error: "Invalid poll ID" }); return; }

  const [poll] = await db.select().from(pollsTable).where(eq(pollsTable.id, pollId));
  if (!poll) { res.status(404).json({ error: "Poll not found" }); return; }
  if (poll.isAnonymous) { res.status(403).json({ error: "Poll is anonymous" }); return; }

  // SECURITY: only conversation participants may see who voted what.
  const [votesMsg] = await db.select({ conversationId: messagesTable.conversationId })
    .from(messagesTable).where(eq(messagesTable.pollId, pollId));
  if (!votesMsg || !(await isConversationMember(userId, votesMsg.conversationId))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const votes = await db.select().from(pollVotesTable).where(eq(pollVotesTable.pollId, pollId));
  const userIds = [...new Set(votes.map(v => v.userId))];
  const users = userIds.length > 0 ? await db.select().from(usersTable).where(inArray(usersTable.id, userIds)) : [];
  const userMap = Object.fromEntries(users.map(u => [u.id, u]));

  const options = await db.select().from(pollOptionsTable).where(eq(pollOptionsTable.pollId, pollId));

  const result = options.map(opt => ({
    optionId: opt.id,
    optionText: opt.text,
    voters: votes
      .filter(v => v.optionId === opt.id)
      .map(v => { const u = userMap[v.userId]; return u ? { id: u.id, displayName: u.displayName, avatar: u.avatar } : null; })
      .filter(Boolean),
  }));

  res.json(result);
});

export default router;
