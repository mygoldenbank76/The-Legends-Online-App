import { useState } from 'react';
import { BarChart2, Users } from 'lucide-react';

type PollOption = {
  id: number;
  text: string;
  voteCount: number;
  percentage: number;
  voters: number[];
};

type Poll = {
  id: number;
  question: string;
  isAnonymous: boolean;
  isMultipleChoice: boolean;
  isQuiz: boolean;
  totalVotes: number;
  userVotedOptionIds: number[];
  options: PollOption[];
};

type Props = {
  poll: Poll;
  isMine: boolean;
  onVote: (pollId: number, optionIds: number[]) => Promise<void>;
  onViewVotes?: (pollId: number) => void;
  conversationId: number;
};

export function PollMessage({ poll, isMine, onVote, onViewVotes }: Props) {
  const [voting, setVoting] = useState(false);
  const [selectedOptions, setSelectedOptions] = useState<number[]>(poll.userVotedOptionIds);
  const hasVoted = poll.userVotedOptionIds.length > 0;

  const handleOptionClick = async (optionId: number) => {
    if (voting) return;

    let newSelected: number[];
    if (poll.isMultipleChoice) {
      if (selectedOptions.includes(optionId)) {
        newSelected = selectedOptions.filter(id => id !== optionId);
      } else {
        newSelected = [...selectedOptions, optionId];
      }
      setSelectedOptions(newSelected);
      if (newSelected.length > 0) {
        setVoting(true);
        try { await onVote(poll.id, newSelected); } finally { setVoting(false); }
      }
    } else {
      newSelected = [optionId];
      setSelectedOptions(newSelected);
      setVoting(true);
      try { await onVote(poll.id, newSelected); } finally { setVoting(false); }
    }
  };

  const barColor = isMine ? 'bg-white/30' : 'bg-primary/40';
  const textClass = isMine ? 'text-primary-foreground' : 'text-foreground';
  const subTextClass = isMine ? 'text-primary-foreground/70' : 'text-muted-foreground';

  return (
    <div className="min-w-[220px] max-w-[280px]">
      {/* Poll header */}
      <div className="flex items-center gap-2 mb-2">
        <BarChart2 className={`w-4 h-4 flex-shrink-0 ${isMine ? 'text-primary-foreground/70' : 'text-primary'}`} />
        <span className={`text-sm font-semibold leading-tight ${textClass}`}>{poll.question}</span>
      </div>

      {/* Options */}
      <div className="space-y-2">
        {poll.options.map(opt => {
          const isSelected = poll.userVotedOptionIds.includes(opt.id);
          const isLocalSelected = selectedOptions.includes(opt.id);
          const showBar = hasVoted || voting;

          return (
            <button
              key={opt.id}
              onClick={() => handleOptionClick(opt.id)}
              className="w-full text-left relative overflow-hidden rounded-xl"
              disabled={voting}
            >
              {/* Background bar */}
              {showBar && (
                <div
                  className={`absolute left-0 top-0 bottom-0 rounded-xl transition-all duration-500 ${barColor}`}
                  style={{ width: `${opt.percentage}%` }}
                />
              )}
              <div className={`relative flex items-center gap-2 px-3 py-2 rounded-xl border transition-colors ${
                isSelected || isLocalSelected
                  ? (isMine ? 'border-white/40 bg-white/10' : 'border-primary/50 bg-primary/10')
                  : (isMine ? 'border-white/20 bg-white/5' : 'border-border/50 bg-card/50')
              }`}>
                {/* Radio circle */}
                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                  isSelected || isLocalSelected
                    ? (isMine ? 'border-white bg-white' : 'border-primary bg-primary')
                    : (isMine ? 'border-white/50' : 'border-muted-foreground/50')
                }`}>
                  {(isSelected || isLocalSelected) && (
                    <div className={`w-1.5 h-1.5 rounded-full ${isMine ? 'bg-primary' : 'bg-primary-foreground'}`} />
                  )}
                </div>
                <span className={`text-xs flex-1 ${textClass}`}>{opt.text}</span>
                {showBar && (
                  <span className={`text-xs font-semibold ml-1 ${subTextClass}`}>{opt.percentage}%</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-2">
        <div className={`text-[10px] ${subTextClass}`}>
          {poll.totalVotes} vote{poll.totalVotes !== 1 ? 's' : ''} · {poll.isAnonymous ? 'Anonyme' : 'Public'}
        </div>
        {!poll.isAnonymous && onViewVotes && (
          <button
            onClick={() => onViewVotes(poll.id)}
            className={`text-[11px] font-medium ${isMine ? 'text-primary-foreground/80 hover:text-primary-foreground' : 'text-primary hover:text-primary/80'} transition-colors`}
          >
            Voir les votes
          </button>
        )}
      </div>
    </div>
  );
}
