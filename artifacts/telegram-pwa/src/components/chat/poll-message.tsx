import { useState, useEffect } from 'react';
import { BarChart2, Loader2, Languages } from 'lucide-react';
import { usePreferences } from '@/lib/preferences-context';

async function translateText(text: string, targetLang: string): Promise<string> {
  const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=autodetect|${targetLang}`);
  const d = await r.json();
  const translated = d.responseData?.translatedText;
  if (!translated || translated === text || d.responseStatus !== 200) return text;
  return translated;
}

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

type TranslatedPoll = {
  question: string;
  options: string[];
};

type Props = {
  poll: Poll;
  isMine: boolean;
  onVote: (pollId: number, optionIds: number[]) => Promise<Poll | void>;
  onViewVotes?: (pollId: number) => void;
};

export function PollMessage({ poll: initialPoll, isMine, onVote, onViewVotes }: Props) {
  const { t, translateLanguage } = usePreferences();
  const [poll, setPoll] = useState<Poll>(initialPoll);
  const [voting, setVoting] = useState(false);
  const [translated, setTranslated] = useState<TranslatedPoll | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);

  useEffect(() => {
    setPoll(initialPoll);
    setTranslated(null);
  }, [initialPoll]);

  const hasVoted = poll.userVotedOptionIds.length > 0;

  const handleOptionClick = async (optionId: number) => {
    if (voting) return;

    let newSelected: number[];
    if (poll.isMultipleChoice) {
      if (poll.userVotedOptionIds.includes(optionId)) {
        newSelected = poll.userVotedOptionIds.filter(id => id !== optionId);
      } else {
        newSelected = [...poll.userVotedOptionIds, optionId];
      }
    } else {
      newSelected = poll.userVotedOptionIds.includes(optionId) ? [] : [optionId];
    }

    const totalDelta = newSelected.length > 0
      ? (hasVoted ? 0 : 1)
      : (hasVoted ? -1 : 0);
    const newTotal = Math.max(0, poll.totalVotes + totalDelta);

    const optimisticOptions = poll.options.map(opt => {
      let votes = opt.voteCount;
      if (hasVoted && poll.userVotedOptionIds.includes(opt.id)) votes -= 1;
      if (newSelected.includes(opt.id)) votes += 1;
      votes = Math.max(0, votes);
      return { ...opt, voteCount: votes, percentage: newTotal > 0 ? Math.round((votes / newTotal) * 100) : 0 };
    });

    setPoll(prev => ({ ...prev, userVotedOptionIds: newSelected, totalVotes: newTotal, options: optimisticOptions }));

    setVoting(true);
    try {
      await onVote(poll.id, newSelected);
    } catch (e) {
      setPoll(initialPoll);
      console.error(e);
    } finally {
      setVoting(false);
    }
  };

  const handleTranslate = async () => {
    if (translated) { setTranslated(null); return; }
    setIsTranslating(true);
    try {
      const [question, ...options] = await Promise.all([
        translateText(poll.question, translateLanguage),
        ...poll.options.map(o => translateText(o.text, translateLanguage)),
      ]);
      setTranslated({ question, options });
    } catch {
      // ignore
    } finally {
      setIsTranslating(false);
    }
  };

  const showBars = hasVoted || poll.userVotedOptionIds.length > 0;

  const textClass = isMine ? 'text-primary-foreground' : 'text-foreground';
  const subTextClass = isMine ? 'text-primary-foreground/70' : 'text-muted-foreground';
  const barBg = isMine ? 'bg-white/25' : 'bg-primary/30';

  const displayQuestion = translated?.question ?? poll.question;
  const displayOptions = poll.options.map((opt, i) => ({
    ...opt,
    displayText: translated?.options[i] ?? opt.text,
  }));

  return (
    <div className="min-w-[220px] max-w-[280px]">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <BarChart2 className={`w-4 h-4 flex-shrink-0 ${isMine ? 'text-primary-foreground/80' : 'text-primary'}`} />
        <span className={`text-sm font-bold leading-tight ${textClass}`}>{displayQuestion}</span>
      </div>

      {/* Options */}
      <div className="space-y-2">
        {displayOptions.map(opt => {
          const isVoted = poll.userVotedOptionIds.includes(opt.id);
          return (
            <button
              key={opt.id}
              onClick={() => handleOptionClick(opt.id)}
              disabled={voting}
              className="w-full text-left relative overflow-hidden rounded-xl focus:outline-none"
            >
              {showBars && (
                <div
                  className={`absolute left-0 top-0 bottom-0 rounded-xl transition-all duration-500 ${barBg}`}
                  style={{ width: `${Math.max(opt.percentage, opt.percentage > 0 ? 8 : 0)}%` }}
                />
              )}
              <div className={`relative flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-all ${
                isVoted
                  ? isMine ? 'border-white/50 bg-white/15' : 'border-primary/60 bg-primary/15'
                  : isMine ? 'border-white/20 bg-white/5 hover:bg-white/10' : 'border-border/60 bg-card/40 hover:bg-card/70'
              }`}>
                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                  isVoted ? (isMine ? 'border-white bg-white' : 'border-primary bg-primary') : (isMine ? 'border-white/40' : 'border-muted-foreground/40')
                }`}>
                  {isVoted && <div className={`w-1.5 h-1.5 rounded-full ${isMine ? 'bg-primary' : 'bg-white'}`} />}
                </div>
                <span className={`text-xs font-medium flex-1 text-left ${textClass}`}>{opt.displayText}</span>
                {showBars && (
                  <span className={`text-xs font-bold ml-1 flex-shrink-0 ${isVoted ? (isMine ? 'text-white' : 'text-primary') : subTextClass}`}>
                    {opt.percentage}%
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-2.5">
        <div className={`text-[11px] flex items-center gap-1 ${subTextClass}`}>
          {voting && <Loader2 className="w-3 h-3 animate-spin" />}
          <span>{poll.totalVotes} vote{poll.totalVotes !== 1 ? 's' : ''} · {poll.isAnonymous ? t.poll.anonymous : t.poll.public}</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Translate button */}
          <button
            onClick={handleTranslate}
            disabled={isTranslating}
            className={`text-[11px] flex items-center gap-0.5 transition-colors ${
              translated
                ? isMine ? 'text-white/60 hover:text-white/80' : 'text-muted-foreground hover:text-foreground'
                : isMine ? 'text-white/80 hover:text-white' : 'text-primary hover:text-primary/80'
            }`}
          >
            {isTranslating
              ? <Loader2 className="w-3 h-3 animate-spin" />
              : <Languages className="w-3 h-3" />
            }
            {!isTranslating && (
              <span className="font-semibold underline-offset-2 hover:underline">
                {translated ? t.chat.hideTranslation : t.chat.translate}
              </span>
            )}
          </button>

          {/* View votes */}
          {!poll.isAnonymous && onViewVotes && (
            <button
              onClick={e => { e.stopPropagation(); onViewVotes(poll.id); }}
              className={`text-[11px] font-semibold transition-colors underline-offset-2 hover:underline ${
                isMine ? 'text-white/80 hover:text-white' : 'text-primary hover:text-primary/80'
              }`}
            >
              {t.poll.viewVotes}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
