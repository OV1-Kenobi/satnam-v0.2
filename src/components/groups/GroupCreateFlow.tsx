/**
 * @component GroupCreateFlow
 * @description Multi-step group creation flow for Guardians.
 *
 * Steps:
 * 1. Enter group name and description
 * 2. Set threshold (e.g., 2-of-3)
 * 3. Add participant pubkeys (npubs)
 * 4. Initiate FROST DKG ceremony
 * 5. Wait for participants to join
 * 6. Display group pubkey when complete
 *
 * Design: Dark theme, bitcoin-orange accents, Cinzel headings.
 */

import React, { useState, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GroupCreateFlowProps {
  onComplete?: (groupPubkey: string) => void;
  onCancel?: () => void;
}

interface GroupConfig {
  name: string;
  description: string;
  threshold: number;
  totalParticipants: number;
  participants: string[]; // npubs
}

type Step = 1 | 2 | 3 | 4 | 5 | 6;

const STEP_LABELS: Record<Step, string> = {
  1: 'Group Info',
  2: 'Threshold',
  3: 'Participants',
  4: 'DKG Ceremony',
  5: 'Waiting',
  6: 'Complete',
};

const TOTAL_STEPS = 6;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StepIndicator({ current, total }: { current: Step; total: number }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-8" role="navigation" aria-label="Step progress">
      {Array.from({ length: total }, (_, i) => {
        const step = (i + 1) as Step;
        const isCompleted = step < current;
        const isCurrent = step === current;
        return (
          <React.Fragment key={step}>
            <div
              className={`
                flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold
                transition-all duration-300
                ${isCompleted
                  ? 'bg-[#F7931A] text-black'
                  : isCurrent
                    ? 'border-2 border-[#F7931A] text-[#F7931A]'
                    : 'border border-[#2a2a2a] text-[#555555]'
                }
              `}
              aria-label={`Step ${step}: ${STEP_LABELS[step]}${isCompleted ? ' (completed)' : isCurrent ? ' (current)' : ''}`}
              aria-current={isCurrent ? 'step' : undefined}
            >
              {isCompleted ? '✓' : step}
            </div>
            {i < total - 1 && (
              <div
                className={`h-px w-8 transition-colors duration-300 ${
                  isCompleted ? 'bg-[#F7931A]' : 'bg-[#2a2a2a]'
                }`}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1: Group Info
// ---------------------------------------------------------------------------

function StepGroupInfo({
  config,
  onChange,
  onNext,
}: {
  config: Pick<GroupConfig, 'name' | 'description'>;
  onChange: (updates: Partial<GroupConfig>) => void;
  onNext: () => void;
}) {
  const isValid = config.name.trim().length >= 2;

  return (
    <div className="space-y-6">
      <div>
        <label htmlFor="group-name" className="block text-sm font-medium text-[#a0a0a0] mb-2">
          Group Name <span className="text-[#F7931A]">*</span>
        </label>
        <input
          id="group-name"
          type="text"
          value={config.name}
          onChange={e => onChange({ name: e.target.value })}
          placeholder="My Family Trust"
          maxLength={64}
          className="
            w-full px-4 py-3 rounded-lg
            bg-[#1a1a1a] border border-[#2a2a2a]
            text-[#f5f5f5] placeholder-[#555555]
            focus:outline-none focus:border-[#F7931A]
            transition-colors
          "
          aria-required="true"
        />
      </div>

      <div>
        <label htmlFor="group-description" className="block text-sm font-medium text-[#a0a0a0] mb-2">
          Description <span className="text-[#555555]">(optional)</span>
        </label>
        <textarea
          id="group-description"
          value={config.description}
          onChange={e => onChange({ description: e.target.value })}
          placeholder="A brief description of this group's purpose..."
          rows={3}
          maxLength={256}
          className="
            w-full px-4 py-3 rounded-lg
            bg-[#1a1a1a] border border-[#2a2a2a]
            text-[#f5f5f5] placeholder-[#555555]
            focus:outline-none focus:border-[#F7931A]
            transition-colors resize-none
          "
        />
      </div>

      <button
        onClick={onNext}
        disabled={!isValid}
        className="
          w-full py-3 rounded-lg font-medium
          bg-[#F7931A] text-black
          hover:bg-[#c46e00] disabled:opacity-40 disabled:cursor-not-allowed
          transition-colors duration-150
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F7931A] focus-visible:ring-offset-2
        "
      >
        Continue
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2: Threshold
// ---------------------------------------------------------------------------

function StepThreshold({
  config,
  onChange,
  onNext,
  onBack,
}: {
  config: Pick<GroupConfig, 'threshold' | 'totalParticipants'>;
  onChange: (updates: Partial<GroupConfig>) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const isValid = config.threshold >= 1 && config.threshold <= config.totalParticipants;

  return (
    <div className="space-y-6">
      <p className="text-sm text-[#a0a0a0]">
        Set the signing threshold. A minimum of{' '}
        <span className="text-[#F7931A] font-semibold">{config.threshold}</span> of{' '}
        <span className="text-[#F7931A] font-semibold">{config.totalParticipants}</span>{' '}
        participants will be required to authorize group operations.
      </p>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="threshold" className="block text-sm font-medium text-[#a0a0a0] mb-2">
            Threshold (M)
          </label>
          <input
            id="threshold"
            type="number"
            min={1}
            max={config.totalParticipants}
            value={config.threshold}
            onChange={e => onChange({ threshold: Math.max(1, parseInt(e.target.value) || 1) })}
            className="
              w-full px-4 py-3 rounded-lg text-center text-xl font-bold
              bg-[#1a1a1a] border border-[#2a2a2a]
              text-[#F7931A]
              focus:outline-none focus:border-[#F7931A]
              transition-colors
            "
          />
        </div>

        <div>
          <label htmlFor="total-participants" className="block text-sm font-medium text-[#a0a0a0] mb-2">
            Total Participants (N)
          </label>
          <input
            id="total-participants"
            type="number"
            min={config.threshold}
            max={20}
            value={config.totalParticipants}
            onChange={e => onChange({ totalParticipants: Math.max(config.threshold, parseInt(e.target.value) || 2) })}
            className="
              w-full px-4 py-3 rounded-lg text-center text-xl font-bold
              bg-[#1a1a1a] border border-[#2a2a2a]
              text-[#f5f5f5]
              focus:outline-none focus:border-[#F7931A]
              transition-colors
            "
          />
        </div>
      </div>

      <div className="p-4 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a]">
        <p className="text-xs text-[#555555] font-mono text-center">
          {config.threshold}-of-{config.totalParticipants} threshold signature
        </p>
      </div>

      <div className="flex gap-3">
        <button onClick={onBack} className="flex-1 py-3 rounded-lg font-medium border border-[#2a2a2a] text-[#a0a0a0] hover:bg-[#1a1a1a] transition-colors">
          Back
        </button>
        <button
          onClick={onNext}
          disabled={!isValid}
          className="flex-1 py-3 rounded-lg font-medium bg-[#F7931A] text-black hover:bg-[#c46e00] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3: Participants
// ---------------------------------------------------------------------------

function StepParticipants({
  config,
  onChange,
  onNext,
  onBack,
}: {
  config: Pick<GroupConfig, 'participants' | 'totalParticipants'>;
  onChange: (updates: Partial<GroupConfig>) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState('');

  const addParticipant = () => {
    const npub = inputValue.trim();
    if (!npub) return;

    if (!npub.startsWith('npub1') && !/^[0-9a-fA-F]{64}$/.test(npub)) {
      setError('Invalid npub or hex pubkey');
      return;
    }
    if (config.participants.includes(npub)) {
      setError('Already added');
      return;
    }
    onChange({ participants: [...config.participants, npub] });
    setInputValue('');
    setError('');
  };

  const removeParticipant = (npub: string) => {
    onChange({ participants: config.participants.filter(p => p !== npub) });
  };

  const isValid = config.participants.length === config.totalParticipants;

  return (
    <div className="space-y-6">
      <p className="text-sm text-[#a0a0a0]">
        Add {config.totalParticipants} participant public key{config.totalParticipants !== 1 ? 's' : ''}.{' '}
        <span className="text-[#F7931A]">{config.participants.length}/{config.totalParticipants}</span> added.
      </p>

      <div className="flex gap-2">
        <input
          type="text"
          value={inputValue}
          onChange={e => { setInputValue(e.target.value); setError(''); }}
          onKeyDown={e => e.key === 'Enter' && addParticipant()}
          placeholder="npub1..."
          className="
            flex-1 px-4 py-3 rounded-lg
            bg-[#1a1a1a] border border-[#2a2a2a]
            text-[#f5f5f5] placeholder-[#555555] font-mono text-sm
            focus:outline-none focus:border-[#F7931A]
            transition-colors
          "
          aria-label="Participant npub"
        />
        <button
          onClick={addParticipant}
          disabled={config.participants.length >= config.totalParticipants}
          className="px-4 py-3 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-[#F7931A] hover:border-[#F7931A] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          aria-label="Add participant"
        >
          +
        </button>
      </div>

      {error && <p className="text-sm text-red-400" role="alert">{error}</p>}

      {config.participants.length > 0 && (
        <ul className="space-y-2" role="list">
          {config.participants.map((npub, i) => (
            <li
              key={npub}
              className="flex items-center gap-3 p-3 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a]"
            >
              <span className="text-xs text-[#555555] font-mono w-4">{i + 1}</span>
              <span className="flex-1 font-mono text-xs text-[#a0a0a0] truncate">{npub}</span>
              <button
                onClick={() => removeParticipant(npub)}
                className="text-[#555555] hover:text-red-400 transition-colors p-1"
                aria-label={`Remove participant ${i + 1}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-3">
        <button onClick={onBack} className="flex-1 py-3 rounded-lg font-medium border border-[#2a2a2a] text-[#a0a0a0] hover:bg-[#1a1a1a] transition-colors">
          Back
        </button>
        <button
          onClick={onNext}
          disabled={!isValid}
          className="flex-1 py-3 rounded-lg font-medium bg-[#F7931A] text-black hover:bg-[#c46e00] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Begin DKG
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4: DKG Ceremony
// ---------------------------------------------------------------------------

function StepDkg({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [initiated, setInitiated] = useState(false);

  return (
    <div className="space-y-6">
      <div className="p-4 rounded-lg border border-[#FFD700]/20 bg-[#FFD700]/5">
        <p className="text-sm text-[#FFD700] font-semibold mb-2">FROST DKG Ceremony</p>
        <p className="text-xs text-[#a0a0a0]">
          A Distributed Key Generation ceremony will be initiated. All participants
          must connect to the same relay and run the DKG protocol. No single party
          ever holds the complete group private key.
        </p>
      </div>

      {!initiated ? (
        <button
          onClick={() => { setInitiated(true); setTimeout(onNext, 1500); }}
          className="w-full py-3 rounded-lg font-medium bg-[#F7931A] text-black hover:bg-[#c46e00] transition-colors"
        >
          Initiate DKG Ceremony
        </button>
      ) : (
        <div className="flex items-center justify-center gap-3 py-4">
          <div className="h-5 w-5 rounded-full border-2 border-[#2a2a2a] border-t-[#F7931A] animate-spin" aria-hidden="true" />
          <span className="text-sm text-[#a0a0a0]">Initiating ceremony…</span>
        </div>
      )}

      {!initiated && (
        <button onClick={onBack} className="w-full py-3 rounded-lg font-medium border border-[#2a2a2a] text-[#a0a0a0] hover:bg-[#1a1a1a] transition-colors">
          Back
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 5: Waiting for Participants
// ---------------------------------------------------------------------------

function StepWaiting({
  config,
  onNext,
}: {
  config: GroupConfig;
  onNext: (groupPubkey: string) => void;
}) {
  const [joined, setJoined] = useState(1); // Guardian already joined

  // Simulate participants joining over time (real: relay subscription)
  React.useEffect(() => {
    if (joined >= config.totalParticipants) return;
    const interval = setInterval(() => {
      setJoined(prev => {
        const next = prev + 1;
        if (next >= config.totalParticipants) {
          clearInterval(interval);
          setTimeout(() => {
            // Generate a mock group pubkey (real: DKG output)
            onNext('02' + Array.from({ length: 64 }, () =>
              Math.floor(Math.random() * 16).toString(16)).join(''));
          }, 800);
        }
        return next;
      });
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="text-4xl font-bold font-mono text-[#F7931A] mb-2">
          {joined}/{config.totalParticipants}
        </div>
        <p className="text-sm text-[#a0a0a0]">participants have joined the ceremony</p>
      </div>

      <div className="space-y-2">
        {Array.from({ length: config.totalParticipants }, (_, i) => (
          <div
            key={i}
            className={`
              flex items-center gap-3 p-3 rounded-lg border transition-colors duration-300
              ${i < joined
                ? 'bg-green-500/10 border-green-500/20'
                : 'bg-[#1a1a1a] border-[#2a2a2a]'
              }
            `}
          >
            <div className={`w-3 h-3 rounded-full ${i < joined ? 'bg-green-500' : 'bg-[#2a2a2a]'}`} />
            <span className="text-sm text-[#a0a0a0] font-mono truncate">
              {i < config.participants.length
                ? config.participants[i]?.slice(0, 20) + '…'
                : `Participant ${i + 1}`
              }
            </span>
            {i < joined && (
              <span className="ml-auto text-xs text-green-500">✓ Joined</span>
            )}
          </div>
        ))}
      </div>

      {joined < config.totalParticipants && (
        <div className="flex items-center justify-center gap-2 text-sm text-[#555555]">
          <div className="h-4 w-4 rounded-full border-2 border-[#2a2a2a] border-t-[#F7931A] animate-spin" />
          Waiting for participants…
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 6: Complete
// ---------------------------------------------------------------------------

function StepComplete({
  groupPubkey,
  config,
  onDone,
}: {
  groupPubkey: string;
  config: GroupConfig;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copyPubkey = () => {
    navigator.clipboard.writeText(groupPubkey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="space-y-6 text-center">
      <div className="flex justify-center">
        <div className="w-16 h-16 rounded-full bg-[#F7931A]/10 border-2 border-[#F7931A] flex items-center justify-center">
          <span className="text-3xl">⚡</span>
        </div>
      </div>

      <div>
        <h3 className="font-display text-xl text-[#F7931A] mb-1">{config.name}</h3>
        <p className="text-sm text-[#a0a0a0]">Group created successfully</p>
      </div>

      <div className="p-4 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-left">
        <p className="text-xs text-[#555555] mb-2 uppercase tracking-wider">Group Public Key</p>
        <button
          onClick={copyPubkey}
          className="w-full text-left font-mono text-xs text-[#a0a0a0] break-all hover:text-[#f5f5f5] transition-colors"
          aria-label="Copy group public key"
        >
          {groupPubkey}
        </button>
        {copied && <p className="text-xs text-green-500 mt-1">Copied!</p>}
      </div>

      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="p-3 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a]">
          <div className="text-xl font-bold text-[#F7931A]">{config.threshold}</div>
          <div className="text-xs text-[#555555]">Threshold</div>
        </div>
        <div className="p-3 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a]">
          <div className="text-xl font-bold text-[#f5f5f5]">{config.totalParticipants}</div>
          <div className="text-xs text-[#555555]">Signers</div>
        </div>
        <div className="p-3 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a]">
          <div className="text-xl font-bold text-green-500">✓</div>
          <div className="text-xs text-[#555555]">Live</div>
        </div>
      </div>

      <button
        onClick={onDone}
        className="w-full py-3 rounded-lg font-medium bg-[#F7931A] text-black hover:bg-[#c46e00] transition-colors"
      >
        Open Group
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function GroupCreateFlow({ onComplete, onCancel }: GroupCreateFlowProps) {
  const [step, setStep] = useState<Step>(1);
  const [config, setConfig] = useState<GroupConfig>({
    name: '',
    description: '',
    threshold: 2,
    totalParticipants: 3,
    participants: [],
  });
  const [groupPubkey, setGroupPubkey] = useState('');

  const updateConfig = useCallback((updates: Partial<GroupConfig>) => {
    setConfig(prev => ({ ...prev, ...updates }));
  }, []);

  const nextStep = () => setStep(prev => Math.min(prev + 1, TOTAL_STEPS) as Step);
  const prevStep = () => setStep(prev => Math.max(prev - 1, 1) as Step);

  return (
    <div
      className="w-full max-w-md mx-auto"
      role="region"
      aria-label="Create group wizard"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-display text-xl text-[#F7931A] tracking-wider uppercase">
          New Group
        </h2>
        {onCancel && (
          <button
            onClick={onCancel}
            className="text-[#555555] hover:text-[#a0a0a0] transition-colors text-xl leading-none"
            aria-label="Cancel group creation"
          >
            ×
          </button>
        )}
      </div>

      {/* Step indicator */}
      <StepIndicator current={step} total={TOTAL_STEPS} />

      {/* Step label */}
      <p className="text-center text-xs text-[#555555] uppercase tracking-widest mb-6">
        Step {step} — {STEP_LABELS[step]}
      </p>

      {/* Step content */}
      <div className="card">
        {step === 1 && (
          <StepGroupInfo config={config} onChange={updateConfig} onNext={nextStep} />
        )}
        {step === 2 && (
          <StepThreshold config={config} onChange={updateConfig} onNext={nextStep} onBack={prevStep} />
        )}
        {step === 3 && (
          <StepParticipants config={config} onChange={updateConfig} onNext={nextStep} onBack={prevStep} />
        )}
        {step === 4 && (
          <StepDkg onNext={nextStep} onBack={prevStep} />
        )}
        {step === 5 && (
          <StepWaiting
            config={config}
            onNext={(pubkey) => { setGroupPubkey(pubkey); nextStep(); }}
          />
        )}
        {step === 6 && (
          <StepComplete
            groupPubkey={groupPubkey}
            config={config}
            onDone={() => onComplete?.(groupPubkey)}
          />
        )}
      </div>
    </div>
  );
}

