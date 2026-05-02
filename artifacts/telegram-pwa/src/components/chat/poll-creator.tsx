import { useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { BarChart2, ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { usePreferences } from '@/lib/preferences-context';

type PollData = {
  question: string;
  options: string[];
  isAnonymous: boolean;
  isMultipleChoice: boolean;
  isQuiz: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSubmit: (poll: PollData) => void;
};

export function PollCreator({ open, onClose, onSubmit }: Props) {
  const { t } = usePreferences();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [isAnonymous, setIsAnonymous] = useState(true);
  const [isMultipleChoice, setIsMultipleChoice] = useState(false);
  const [isQuiz, setIsQuiz] = useState(false);

  const maxOptions = 12;

  const reset = () => {
    setQuestion('');
    setOptions(['', '']);
    setIsAnonymous(true);
    setIsMultipleChoice(false);
    setIsQuiz(false);
  };

  const handleClose = () => { reset(); onClose(); };

  const handleSubmit = () => {
    const filteredOptions = options.filter(o => o.trim().length > 0);
    if (!question.trim() || filteredOptions.length < 2) return;
    onSubmit({ question: question.trim(), options: filteredOptions, isAnonymous, isMultipleChoice, isQuiz });
    reset();
    onClose();
  };

  const addOption = () => {
    if (options.length < maxOptions) setOptions(p => [...p, '']);
  };

  const removeOption = (idx: number) => {
    if (options.length > 2) setOptions(p => p.filter((_, i) => i !== idx));
  };

  const updateOption = (idx: number, val: string) => {
    setOptions(p => p.map((o, i) => i === idx ? val : o));
  };

  const canSubmit = question.trim().length > 0 && options.filter(o => o.trim()).length >= 2;
  const remaining = maxOptions - options.length;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="poll-creator-page"
          initial={{ x: '100%', opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '100%', opacity: 0 }}
          transition={{ type: 'spring', damping: 32, stiffness: 320 }}
          className="fixed inset-0 z-[450] bg-background flex flex-col"
        >
          {/* Header */}
          <div
            className="flex items-center gap-3 px-3 py-3 border-b border-white/10 flex-shrink-0"
            style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))' }}
          >
            <button
              onClick={handleClose}
              className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
              data-testid="button-back-poll-creator"
              aria-label={t.chat.back}
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="w-10 h-10 rounded-xl gradient-primary glow-primary-sm flex items-center justify-center">
              <BarChart2 className="w-5 h-5 text-white" />
            </div>
            <h2 className="text-base font-bold text-foreground flex-1">{t.poll.title}</h2>
          </div>

          {/* Scrollable body */}
          <div
            className="flex-1 overflow-y-auto overscroll-contain px-4 pt-4 space-y-4"
            style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}
          >
            {/* Question */}
            <div>
              <label className="text-xs font-semibold text-primary mb-2 block">{t.poll.question}</label>
              <textarea
                value={question}
                onChange={e => setQuestion(e.target.value)}
                placeholder={t.poll.questionPlaceholder}
                rows={2}
                className="w-full glass rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground border border-border/50 focus:border-primary/40 focus:outline-none resize-none"
              />
            </div>

            {/* Options */}
            <div>
              <label className="text-xs font-semibold text-primary mb-2 block">{t.poll.options}</label>
              <div className="space-y-2">
                {options.map((opt, idx) => {
                  const filled = opt.trim().length > 0;
                  return (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        value={opt}
                        onChange={e => updateOption(idx, e.target.value)}
                        placeholder={`Option ${idx + 1}`}
                        className={`flex-1 rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground border focus:outline-none transition-colors ${
                          filled
                            ? 'gradient-primary-soft border-primary/35 focus:border-primary/55'
                            : 'glass border-border/50 focus:border-primary/40'
                        }`}
                      />
                      {options.length > 2 && (
                        <button onClick={() => removeOption(idx)} className="text-muted-foreground hover:text-red-400 transition-colors p-1">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              {options.length < maxOptions && (
                <button onClick={addOption} className="flex items-center gap-2 mt-2 text-sm text-primary hover:text-primary/80 transition-colors">
                  <div className="w-6 h-6 rounded-full gradient-primary-soft border border-primary/30 flex items-center justify-center">
                    <Plus className="w-3 h-3" />
                  </div>
                  {t.poll.addOption}
                </button>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                {t.poll.remainingOptions.replace('{n}', String(remaining))}
              </p>
            </div>

            {/* Settings */}
            <div>
              <label className="text-xs font-semibold text-primary mb-3 block">{t.poll.settings}</label>
              <div className="space-y-3">
                <Toggle label={t.poll.anonymousVote} value={isAnonymous} onChange={setIsAnonymous} />
                <Toggle label={t.poll.multipleChoice} value={isMultipleChoice} onChange={setIsMultipleChoice} />
              </div>
            </div>

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="w-full py-3.5 rounded-2xl gradient-primary glow-primary text-white font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-95 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:opacity-40"
            >
              <BarChart2 className="w-4 h-4" />
              {t.poll.create}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-foreground">{label}</span>
      <button
        onClick={() => onChange(!value)}
        className={`w-12 h-6 rounded-full relative transition-colors ${value ? 'bg-primary' : 'bg-muted'}`}
      >
        <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-6' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}
