/**
 * AgentCreateFlow — Multi-step agent creation wizard
 * Phase 3: NIP-SA agent management
 *
 * Steps:
 *   1. Identity (name, about, picture URL)
 *   2. Capabilities (research, summarization, nip90-provider, etc.)
 *   3. Autonomy level (bounded / supervised / autonomous)
 *   4. Spend policy (limits, rail, mints)
 *   5. Skills assignment
 *   6. Relay selection
 *   7. Review + create (publishes kind:39200 via CEPS)
 */

import { useState, useCallback, Fragment } from 'react';
import clsx from 'clsx';
import {
  User,
  Zap,
  Shield,
  Coins,
  BookOpen,
  Radio,
  CheckCircle,
  ChevronRight,
  ChevronLeft,
  X,
  Plus,
} from 'lucide-react';
import { useAgentProfile } from '../../hooks/useAgentProfile.js';
import { useSkillManager } from '../../hooks/useSkillManager.js';
import SpendPolicyEditor from './SpendPolicyEditor.js';
import type { SpendPolicy } from '../../hooks/useAgentProfile.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentCreateFlowProps {
  onComplete: (agentId: string) => void;
  onCancel: () => void;
}

type AutonomyLevel = 'bounded' | 'supervised' | 'autonomous';

interface FormState {
  // Step 1: Identity
  name: string;
  about: string;
  picture: string;

  // Step 2: Capabilities
  capabilities: string[];

  // Step 3: Autonomy
  autonomy: AutonomyLevel;

  // Step 4: Spend policy
  spendPolicy: SpendPolicy;

  // Step 5: Skills
  selectedSkills: string[];

  // Step 6: Relays
  relays: string[];
}

const CAPABILITY_OPTIONS = [
  { id: 'research', label: 'Research', description: 'Web search and data gathering' },
  { id: 'summarization', label: 'Summarization', description: 'Condense and summarize content' },
  { id: 'nip90-provider', label: 'NIP-90 Provider', description: 'Serve DVM job requests' },
  { id: 'nip90-consumer', label: 'NIP-90 Consumer', description: 'Submit DVM job requests' },
  { id: 'content-creation', label: 'Content Creation', description: 'Generate text and media' },
  { id: 'code-execution', label: 'Code Execution', description: 'Run and analyze code' },
  { id: 'translation', label: 'Translation', description: 'Multi-language translation' },
  { id: 'moderation', label: 'Moderation', description: 'Content moderation tasks' },
  { id: 'data-analysis', label: 'Data Analysis', description: 'Analyze and visualize data' },
  { id: 'scheduling', label: 'Scheduling', description: 'Time-based task management' },
];

const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
];

const DEFAULT_SPEND_POLICY: SpendPolicy = {
  max_single_spend_msats: 10_000_000n, // 10,000 sats
  daily_limit_msats: 100_000_000n,     // 100,000 sats
  requires_approval_above_msats: 50_000_000n, // 50,000 sats
  preferred_spend_rail: 'auto',
  allowed_mints: [],
  sweep_threshold_msats: 500_000_000n, // 500,000 sats
  sweep_destination: '',
  sweep_rail: 'cashu' as const,
};

const STEPS = [
  { id: 1, label: 'Identity', icon: User },
  { id: 2, label: 'Capabilities', icon: Zap },
  { id: 3, label: 'Autonomy', icon: Shield },
  { id: 4, label: 'Spend Policy', icon: Coins },
  { id: 5, label: 'Skills', icon: BookOpen },
  { id: 6, label: 'Relays', icon: Radio },
  { id: 7, label: 'Review', icon: CheckCircle },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSats(msats: bigint): string {
  return (msats / 1000n).toLocaleString();
}

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-1 mb-6" role="progressbar" aria-valuenow={current} aria-valuemax={total}>
      {STEPS.map((step, idx) => {
        const isCompleted = current > step.id;
        const isCurrent = current === step.id;
        const Icon = step.icon;
        return (
          <Fragment key={step.id}>
            <div
              className={clsx(
                'flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold transition-all duration-200',
                isCompleted && 'bg-green-600 text-white',
                isCurrent && 'bg-[#f7931a] text-black',
                !isCompleted && !isCurrent && 'bg-slate-800 text-slate-500',
              )}
              aria-label={`Step ${step.id}: ${step.label}${isCompleted ? ' (completed)' : isCurrent ? ' (current)' : ''}`}
            >
              <Icon size={14} />
            </div>
            {idx < STEPS.length - 1 && (
              <div className={clsx('flex-1 h-0.5 transition-colors', isCompleted ? 'bg-green-600' : 'bg-slate-800')} />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1: Identity
// ---------------------------------------------------------------------------

function StepIdentity({
  form,
  onChange,
}: {
  form: FormState;
  onChange: (updates: Partial<FormState>) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="heading-display text-xl text-[#f7931a] mb-1">Agent Identity</h2>
        <p className="text-sm text-[#555555]">Define the agent's public profile on Nostr.</p>
      </div>

      <div>
        <label htmlFor="agent-name" className="block text-sm font-medium text-[#a0a0a0] mb-2">
          Name <span className="text-[#f7931a]">*</span>
        </label>
        <input
          id="agent-name"
          type="text"
          value={form.name}
          onChange={e => onChange({ name: e.target.value })}
          placeholder="My Research Agent"
          maxLength={64}
          aria-required="true"
          className="w-full px-4 py-3 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-[#f5f5f5] placeholder-[#555555] focus:outline-none focus:border-[#f7931a] transition-colors"
        />
      </div>

      <div>
        <label htmlFor="agent-about" className="block text-sm font-medium text-[#a0a0a0] mb-2">
          About
        </label>
        <textarea
          id="agent-about"
          value={form.about}
          onChange={e => onChange({ about: e.target.value })}
          placeholder="What does this agent do?"
          rows={3}
          maxLength={256}
          className="w-full px-4 py-3 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-[#f5f5f5] placeholder-[#555555] focus:outline-none focus:border-[#f7931a] transition-colors resize-none"
        />
        <p className="mt-1 text-xs text-[#555555]">{form.about.length}/256</p>
      </div>

      <div>
        <label htmlFor="agent-picture" className="block text-sm font-medium text-[#a0a0a0] mb-2">
          Picture URL
        </label>
        <input
          id="agent-picture"
          type="url"
          value={form.picture}
          onChange={e => onChange({ picture: e.target.value })}
          placeholder="https://example.com/avatar.jpg"
          className="w-full px-4 py-3 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-[#f5f5f5] placeholder-[#555555] focus:outline-none focus:border-[#f7931a] transition-colors"
        />
        {form.picture && (
          <div className="mt-3 flex items-center gap-3">
            <img
              src={form.picture}
              alt="Agent avatar preview"
              className="w-12 h-12 rounded-full object-cover border border-[#2a2a2a]"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
            <span className="text-xs text-[#555555]">Preview</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2: Capabilities
// ---------------------------------------------------------------------------

function StepCapabilities({
  form,
  onChange,
}: {
  form: FormState;
  onChange: (updates: Partial<FormState>) => void;
}) {
  const toggle = (id: string) => {
    const caps = form.capabilities.includes(id)
      ? form.capabilities.filter(c => c !== id)
      : [...form.capabilities, id];
    onChange({ capabilities: caps });
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="heading-display text-xl text-[#f7931a] mb-1">Capabilities</h2>
        <p className="text-sm text-[#555555]">Select what this agent is authorized to do.</p>
      </div>

      <div className="grid grid-cols-1 gap-2" role="group" aria-label="Agent capabilities">
        {CAPABILITY_OPTIONS.map(cap => {
          const selected = form.capabilities.includes(cap.id);
          return (
            <button
              key={cap.id}
              type="button"
              onClick={() => toggle(cap.id)}
              aria-pressed={selected}
              className={clsx(
                'flex items-center gap-3 px-4 py-3 rounded-lg border text-left transition-all',
                selected
                  ? 'border-[#f7931a] bg-[#f7931a]/10 text-[#f5f5f5]'
                  : 'border-[#2a2a2a] bg-[#1a1a1a] text-[#a0a0a0] hover:border-[#3a3a3a]',
              )}
            >
              <div className={clsx(
                'w-4 h-4 rounded border flex items-center justify-center flex-shrink-0',
                selected ? 'border-[#f7931a] bg-[#f7931a]' : 'border-[#555555]',
              )}>
                {selected && <span className="text-black text-xs">✓</span>}
              </div>
              <div>
                <p className="text-sm font-medium">{cap.label}</p>
                <p className="text-xs text-[#555555]">{cap.description}</p>
              </div>
            </button>
          );
        })}
      </div>

      {form.capabilities.length === 0 && (
        <p className="text-xs text-yellow-600">Select at least one capability.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3: Autonomy
// ---------------------------------------------------------------------------

function StepAutonomy({
  form,
  onChange,
}: {
  form: FormState;
  onChange: (updates: Partial<FormState>) => void;
}) {
  const AUTONOMY_OPTIONS: Array<{
    id: AutonomyLevel;
    label: string;
    description: string;
    color: string;
  }> = [
    {
      id: 'bounded',
      label: 'Bounded',
      description: 'All actions require explicit approval. Safest option for new agents.',
      color: 'border-blue-600 bg-blue-600/10',
    },
    {
      id: 'supervised',
      label: 'Supervised',
      description: 'Operates within spend limits. Approval required above threshold.',
      color: 'border-[#f7931a] bg-[#f7931a]/10',
    },
    {
      id: 'autonomous',
      label: 'Autonomous',
      description: 'Full autonomy within spend policy. Use only for trusted, well-tested agents.',
      color: 'border-yellow-600 bg-yellow-600/10',
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="heading-display text-xl text-[#f7931a] mb-1">Autonomy Level</h2>
        <p className="text-sm text-[#555555]">Controls how much the agent can act independently.</p>
      </div>

      <div className="space-y-3" role="radiogroup" aria-label="Autonomy level">
        {AUTONOMY_OPTIONS.map(opt => {
          const selected = form.autonomy === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onChange({ autonomy: opt.id })}
              role="radio"
              aria-checked={selected}
              className={clsx(
                'w-full text-left px-4 py-4 rounded-xl border transition-all',
                selected ? opt.color : 'border-[#2a2a2a] bg-[#1a1a1a]',
              )}
            >
              <div className="flex items-center gap-3">
                <div className={clsx(
                  'w-4 h-4 rounded-full border-2 flex-shrink-0',
                  selected ? 'border-[#f7931a] bg-[#f7931a]' : 'border-[#555555]',
                )} />
                <div>
                  <p className="font-medium text-[#f5f5f5]">{opt.label}</p>
                  <p className="text-xs text-[#555555] mt-0.5">{opt.description}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 5: Skills assignment
// ---------------------------------------------------------------------------

function StepSkills({
  form,
  onChange,
}: {
  form: FormState;
  onChange: (updates: Partial<FormState>) => void;
}) {
  const { skills, isLoading } = useSkillManager();

  const toggle = (skillId: string) => {
    const next = form.selectedSkills.includes(skillId)
      ? form.selectedSkills.filter(s => s !== skillId)
      : [...form.selectedSkills, skillId];
    onChange({ selectedSkills: next });
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="heading-display text-xl text-[#f7931a] mb-1">Skill Assignment</h2>
        <p className="text-sm text-[#555555]">Select registered skills to enable for this agent.</p>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-14 skeleton rounded-lg" />
          ))}
        </div>
      ) : skills.length === 0 ? (
        <div className="text-center py-8">
          <BookOpen size={32} className="mx-auto text-[#555555] mb-3" />
          <p className="text-sm text-[#555555]">No skills registered yet.</p>
          <p className="text-xs text-[#555555] mt-1">You can register skills in the Skills tab.</p>
        </div>
      ) : (
        <div className="space-y-2" role="group" aria-label="Skill selection">
          {skills.map(skill => {
            const selected = form.selectedSkills.includes(skill.manifest.manifestEventId);
            return (
              <button
                key={skill.manifest.manifestEventId}
                type="button"
                onClick={() => toggle(skill.manifest.manifestEventId)}
                aria-pressed={selected}
                className={clsx(
                  'w-full flex items-center gap-3 px-4 py-3 rounded-lg border text-left transition-all',
                  selected
                    ? 'border-[#f7931a] bg-[#f7931a]/10'
                    : 'border-[#2a2a2a] bg-[#1a1a1a] hover:border-[#3a3a3a]',
                )}
              >
                <div className={clsx(
                  'w-4 h-4 rounded border flex items-center justify-center flex-shrink-0',
                  selected ? 'border-[#f7931a] bg-[#f7931a]' : 'border-[#555555]',
                )}>
                  {selected && <span className="text-black text-xs">✓</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#f5f5f5] truncate">{skill.manifest.name}</p>
                  <p className="text-xs text-[#555555]">v{skill.manifest.version} · {skill.manifest.skillScopeId}</p>
                </div>
                <span className="text-xs text-[#555555] flex-shrink-0">
                  {skill.attestations.length} attestation{skill.attestations.length !== 1 ? 's' : ''}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 6: Relays
// ---------------------------------------------------------------------------

function StepRelays({
  form,
  onChange,
}: {
  form: FormState;
  onChange: (updates: Partial<FormState>) => void;
}) {
  const [newRelay, setNewRelay] = useState('');

  const addRelay = () => {
    const url = newRelay.trim();
    if (!url || !url.startsWith('wss://') || form.relays.includes(url)) return;
    onChange({ relays: [...form.relays, url] });
    setNewRelay('');
  };

  const removeRelay = (relay: string) => {
    onChange({ relays: form.relays.filter(r => r !== relay) });
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="heading-display text-xl text-[#f7931a] mb-1">Coordination Relays</h2>
        <p className="text-sm text-[#555555]">Relays used for agent communication and state sync.</p>
      </div>

      <ul className="space-y-2" role="list" aria-label="Selected relays">
        {form.relays.map(relay => (
          <li key={relay} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a]">
            <Radio size={14} className="text-[#555555] flex-shrink-0" />
            <span className="font-mono text-xs text-[#a0a0a0] flex-1 truncate">{relay}</span>
            <button
              type="button"
              onClick={() => removeRelay(relay)}
              aria-label={`Remove relay ${relay}`}
              className="text-[#555555] hover:text-red-400 transition-colors"
            >
              <X size={14} />
            </button>
          </li>
        ))}
      </ul>

      <div className="flex gap-2">
        <input
          type="url"
          value={newRelay}
          onChange={e => setNewRelay(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addRelay()}
          placeholder="wss://relay.example.com"
          className="flex-1 px-3 py-2 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-[#f5f5f5] placeholder-[#555555] text-sm font-mono focus:outline-none focus:border-[#f7931a] transition-colors"
          aria-label="New relay URL"
        />
        <button
          type="button"
          onClick={addRelay}
          aria-label="Add relay"
          className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
        >
          <Plus size={16} />
        </button>
      </div>

      {form.relays.length === 0 && (
        <p className="text-xs text-yellow-600">Add at least one relay.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 7: Review
// ---------------------------------------------------------------------------

function StepReview({ form, isLoading }: { form: FormState; isLoading: boolean }) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="heading-display text-xl text-[#f7931a] mb-1">Review & Create</h2>
        <p className="text-sm text-[#555555]">Confirm your agent configuration before publishing.</p>
      </div>

      <div className="space-y-3">
        {/* Identity */}
        <div className="card p-4">
          <p className="text-xs text-[#555555] uppercase tracking-widest mb-2">Identity</p>
          <div className="flex items-center gap-3">
            {form.picture ? (
              <img src={form.picture} alt="Agent" className="w-10 h-10 rounded-full object-cover border border-[#2a2a2a]" />
            ) : (
              <div className="w-10 h-10 rounded-full bg-[#f7931a]/20 border border-[#f7931a]/30 flex items-center justify-center">
                <User size={18} className="text-[#f7931a]" />
              </div>
            )}
            <div>
              <p className="font-medium text-[#f5f5f5]">{form.name || '(unnamed)'}</p>
              {form.about && <p className="text-xs text-[#555555] mt-0.5">{form.about}</p>}
            </div>
          </div>
        </div>

        {/* Autonomy + Capabilities */}
        <div className="card p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-[#555555]">Autonomy</span>
            <span className="font-medium text-[#f5f5f5] capitalize">{form.autonomy}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-[#555555]">Capabilities</span>
            <span className="font-medium text-[#f5f5f5]">{form.capabilities.length} selected</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-[#555555]">Skills</span>
            <span className="font-medium text-[#f5f5f5]">{form.selectedSkills.length} assigned</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-[#555555]">Relays</span>
            <span className="font-medium text-[#f5f5f5]">{form.relays.length} configured</span>
          </div>
        </div>

        {/* Spend Policy */}
        <div className="card p-4 space-y-2">
          <p className="text-xs text-[#555555] uppercase tracking-widest mb-2">Spend Policy</p>
          <div className="flex justify-between text-sm">
            <span className="text-[#555555]">Max single spend</span>
            <span className="font-medium text-[#f5f5f5]">{formatSats(form.spendPolicy.max_single_spend_msats)} sats</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-[#555555]">Daily limit</span>
            <span className="font-medium text-[#f5f5f5]">{formatSats(form.spendPolicy.daily_limit_msats)} sats</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-[#555555]">Rail</span>
            <span className="font-medium text-[#f5f5f5] capitalize">{form.spendPolicy.preferred_spend_rail}</span>
          </div>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-[#f7931a]">
          <div className="w-4 h-4 rounded-full border-2 border-[#2a2a2a] border-t-[#f7931a] animate-spin" />
          Publishing agent to Nostr…
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function AgentCreateFlow({ onComplete, onCancel }: AgentCreateFlowProps) {
  const { createAgent, isLoading } = useAgentProfile();
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({
    name: '',
    about: '',
    picture: '',
    capabilities: [],
    autonomy: 'supervised',
    spendPolicy: DEFAULT_SPEND_POLICY,
    selectedSkills: [],
    relays: [...DEFAULT_RELAYS],
  });

  const updateForm = useCallback((updates: Partial<FormState>) => {
    setForm(prev => ({ ...prev, ...updates }));
  }, []);

  const canAdvance = () => {
    switch (step) {
      case 1: return form.name.trim().length > 0;
      case 2: return form.capabilities.length > 0;
      case 3: return true;
      case 4: return true;
      case 5: return true;
      case 6: return form.relays.length > 0;
      case 7: return true;
      default: return true;
    }
  };

  const handleNext = async () => {
    if (step < STEPS.length) {
      setStep(s => s + 1);
    } else {
      // Final step: create agent
      setError(null);
      try {
        const agentId = await createAgent({
          name: form.name,
          about: form.about,
          picture: form.picture,
          autonomyLevel: form.autonomy,
          capabilities: form.capabilities,
          enabledSkills: form.selectedSkills,
          walletPolicy: form.spendPolicy,
          coordinationRelays: form.relays,
          // governorPubkey is resolved by the hook from the active vault session
          governorPubkey: '',
        });
        onComplete(agentId);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create agent');
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="heading-display text-2xl text-[#f7931a]">New Agent</h1>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel agent creation"
          className="p-2 rounded-lg text-[#555555] hover:text-[#a0a0a0] hover:bg-slate-800 transition-colors"
        >
          <X size={20} />
        </button>
      </div>

      {/* Step indicator */}
      <StepIndicator current={step} total={STEPS.length} />

      {/* Step label */}
      <p className="text-xs text-[#555555] uppercase tracking-widest">
        Step {step} of {STEPS.length} — {STEPS[step - 1]?.label ?? STEPS[0]?.label ?? ''}
      </p>

      {/* Step content */}
      <div className="min-h-[320px]">
        {step === 1 && <StepIdentity form={form} onChange={updateForm} />}
        {step === 2 && <StepCapabilities form={form} onChange={updateForm} />}
        {step === 3 && <StepAutonomy form={form} onChange={updateForm} />}
        {step === 4 && (
          <div className="space-y-4">
            <div>
              <h2 className="heading-display text-xl text-[#f7931a] mb-1">Spend Policy</h2>
              <p className="text-sm text-[#555555]">Configure spending limits and rails for this agent.</p>
            </div>
            <SpendPolicyEditor
              value={form.spendPolicy}
              onChange={policy => updateForm({ spendPolicy: policy })}
            />
          </div>
        )}
        {step === 5 && <StepSkills form={form} onChange={updateForm} />}
        {step === 6 && <StepRelays form={form} onChange={updateForm} />}
        {step === 7 && <StepReview form={form} isLoading={isLoading} />}
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-600/10 border border-red-600/30 text-red-400 text-sm" role="alert">
          {error}
        </div>
      )}

      {/* Navigation */}
      <div className="flex gap-3">
        {step > 1 && (
          <button
            type="button"
            onClick={() => setStep(s => s - 1)}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-50 transition-colors"
          >
            <ChevronLeft size={16} />
            Back
          </button>
        )}
        <button
          type="button"
          onClick={handleNext}
          disabled={!canAdvance() || isLoading}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[#f7931a] hover:bg-[#e8841a] text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {step === STEPS.length ? (
            isLoading ? 'Creating…' : 'Create Agent'
          ) : (
            <>
              Next
              <ChevronRight size={16} />
            </>
          )}
        </button>
      </div>
    </div>
  );
}


