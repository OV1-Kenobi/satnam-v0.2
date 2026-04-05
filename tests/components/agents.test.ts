/**
 * tests/components/agents.test.ts
 * Phase 3 UI component tests — Agent components
 *
 * Tests:
 * - AgentCard renders with correct data
 * - AgentCreateFlow step transitions
 * - SpendPolicyEditor validates inputs
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock hooks — they will be provided by real implementations at runtime
vi.mock('../../src/hooks/useAgentProfile', () => ({
  useAgentProfile: () => ({
    agents: [],
    createAgent: vi.fn().mockResolvedValue('mock-agent-id'),
    updateAgent: vi.fn().mockResolvedValue(undefined),
    deactivateAgent: vi.fn().mockResolvedValue(undefined),
    isLoading: false,
  }),
}));

vi.mock('../../src/hooks/useSkillManager', () => ({
  useSkillManager: () => ({
    skills: [],
    registerSkill: vi.fn().mockResolvedValue('mock-skill-id'),
    attestSkill: vi.fn().mockResolvedValue(undefined),
    revokeSkill: vi.fn().mockResolvedValue(undefined),
    isLoading: false,
  }),
}));

vi.mock('../../src/hooks/useCreditLifecycle', () => ({
  useCreditLifecycle: () => ({
    envelopes: [],
    createIntent: vi.fn().mockResolvedValue('mock-envelope-id'),
    acceptOffer: vi.fn().mockResolvedValue(undefined),
    settleEnvelope: vi.fn().mockResolvedValue(undefined),
    isLoading: false,
  }),
}));

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const MOCK_AGENT = {
  id: 'agent-001',
  pubkey: 'a1b2c3d4e5f6' + '00'.repeat(26),
  name: 'Research Agent',
  about: 'Autonomous research assistant',
  picture: '',
  autonomy: 'supervised' as const,
  status: 'active' as const,
  capabilities: ['research', 'summarization'],
  skills: ['skill-001'],
  spendPolicy: {
    max_single_spend_msats: 10_000_000,
    daily_limit_msats: 100_000_000,
    requires_approval_above_msats: 50_000_000,
    preferred_spend_rail: 'auto' as const,
    allowed_mints: [],
  },
  relays: ['wss://relay.damus.io'],
  balanceSats: 50_000,
  dailySpendSats: 1_234,
  lastHeartbeat: Math.floor(Date.now() / 1000) - 30,
  createdAt: Math.floor(Date.now() / 1000) - 86400,
  errorLog: [],
};

const MOCK_SPEND_POLICY = {
  max_single_spend_msats: 10_000_000,
  daily_limit_msats: 100_000_000,
  requires_approval_above_msats: 50_000_000,
  preferred_spend_rail: 'auto' as const,
  allowed_mints: [],
};

// ---------------------------------------------------------------------------
// AgentCard tests
// ---------------------------------------------------------------------------

describe('AgentCard', () => {
  let AgentCard: typeof import('../../src/components/agents/AgentCard').default;

  beforeEach(async () => {
    const module = await import('../../src/components/agents/AgentCard');
    AgentCard = module.default;
  });

  it('renders agent name', () => {
    render(React.createElement(AgentCard, { agent: MOCK_AGENT }));
    expect(screen.getByText('Research Agent')).toBeTruthy();
  });

  it('renders status badge', () => {
    render(React.createElement(AgentCard, { agent: MOCK_AGENT }));
    expect(screen.getByText('active')).toBeTruthy();
  });

  it('renders autonomy badge', () => {
    render(React.createElement(AgentCard, { agent: MOCK_AGENT }));
    expect(screen.getByText('supervised')).toBeTruthy();
  });

  it('renders balance in sats', () => {
    render(React.createElement(AgentCard, { agent: MOCK_AGENT }));
    // 50,000 sats formatted with commas
    expect(screen.getByText('50,000')).toBeTruthy();
  });

  it('renders daily spend', () => {
    render(React.createElement(AgentCard, { agent: MOCK_AGENT }));
    expect(screen.getByText('1,234')).toBeTruthy();
  });

  it('renders skill chips', () => {
    render(React.createElement(AgentCard, { agent: MOCK_AGENT }));
    expect(screen.getByText('skill-001')).toBeTruthy();
  });

  it('calls onSelect when card clicked', async () => {
    const onSelect = vi.fn();
    const { container } = render(React.createElement(AgentCard, { agent: MOCK_AGENT, onSelect }));
    const article = container.querySelector('article');
    if (article) fireEvent.click(article);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('calls onPause when pause button clicked', async () => {
    const onPause = vi.fn();
    render(React.createElement(AgentCard, { agent: MOCK_AGENT, onPause }));
    const pauseBtn = screen.getByLabelText('Pause agent Research Agent');
    fireEvent.click(pauseBtn);
    expect(onPause).toHaveBeenCalledWith('agent-001');
  });

  it('calls onEdit when edit button clicked', async () => {
    const onEdit = vi.fn();
    render(React.createElement(AgentCard, { agent: MOCK_AGENT, onEdit }));
    const editBtn = screen.getByLabelText('Edit agent Research Agent');
    fireEvent.click(editBtn);
    expect(onEdit).toHaveBeenCalledWith('agent-001');
  });

  it('calls onDeactivate when deactivate button clicked', async () => {
    const onDeactivate = vi.fn();
    render(React.createElement(AgentCard, { agent: MOCK_AGENT, onDeactivate }));
    const deactivateBtn = screen.getByLabelText('Deactivate agent Research Agent');
    fireEvent.click(deactivateBtn);
    expect(onDeactivate).toHaveBeenCalledWith('agent-001');
  });

  it('renders "paused" status for paused agent', () => {
    const pausedAgent = { ...MOCK_AGENT, status: 'paused' as const };
    render(React.createElement(AgentCard, { agent: pausedAgent }));
    expect(screen.getByText('paused')).toBeTruthy();
  });

  it('renders "Resume" button for paused agent', () => {
    const pausedAgent = { ...MOCK_AGENT, status: 'paused' as const };
    render(React.createElement(AgentCard, { agent: pausedAgent }));
    expect(screen.getByText('Resume')).toBeTruthy();
  });

  it('does not render actions for terminated agent', () => {
    const terminatedAgent = { ...MOCK_AGENT, status: 'terminated' as const };
    render(React.createElement(AgentCard, { agent: terminatedAgent }));
    expect(screen.queryByLabelText(/Pause/)).toBeNull();
  });

  it('renders heartbeat time', () => {
    render(React.createElement(AgentCard, { agent: MOCK_AGENT }));
    // 30s ago
    expect(screen.getByText('30s ago')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// AgentCreateFlow tests
// ---------------------------------------------------------------------------

describe('AgentCreateFlow', () => {
  let AgentCreateFlow: typeof import('../../src/components/agents/AgentCreateFlow').default;

  beforeEach(async () => {
    const module = await import('../../src/components/agents/AgentCreateFlow');
    AgentCreateFlow = module.default;
  });

  it('renders step 1 (identity) by default', () => {
    render(React.createElement(AgentCreateFlow, {
      onComplete: vi.fn(),
      onCancel: vi.fn(),
    }));
    expect(screen.getByText('Agent Identity')).toBeTruthy();
  });

  it('shows "Next" button on first step', () => {
    render(React.createElement(AgentCreateFlow, {
      onComplete: vi.fn(),
      onCancel: vi.fn(),
    }));
    expect(screen.getByText(/Next/)).toBeTruthy();
  });

  it('Next button disabled when name is empty', () => {
    render(React.createElement(AgentCreateFlow, {
      onComplete: vi.fn(),
      onCancel: vi.fn(),
    }));
    const nextBtn = screen.getByText(/Next/).closest('button');
    expect(nextBtn?.disabled).toBe(true);
  });

  it('Next button enabled after entering name', async () => {
    const user = userEvent.setup();
    render(React.createElement(AgentCreateFlow, {
      onComplete: vi.fn(),
      onCancel: vi.fn(),
    }));
    const nameInput = screen.getByLabelText('Name');
    await user.type(nameInput, 'My Test Agent');
    const nextBtn = screen.getByText(/Next/).closest('button');
    expect(nextBtn?.disabled).toBe(false);
  });

  it('advances to step 2 (capabilities) after filling name and clicking Next', async () => {
    const user = userEvent.setup();
    render(React.createElement(AgentCreateFlow, {
      onComplete: vi.fn(),
      onCancel: vi.fn(),
    }));
    const nameInput = screen.getByLabelText('Name');
    await user.type(nameInput, 'My Test Agent');
    const nextBtn = screen.getByText(/Next/).closest('button');
    if (nextBtn) await user.click(nextBtn);
    expect(screen.getByText('Capabilities')).toBeTruthy();
  });

  it('shows Back button from step 2 onwards', async () => {
    const user = userEvent.setup();
    render(React.createElement(AgentCreateFlow, {
      onComplete: vi.fn(),
      onCancel: vi.fn(),
    }));
    const nameInput = screen.getByLabelText('Name');
    await user.type(nameInput, 'My Test Agent');
    const nextBtn = screen.getByText(/Next/).closest('button');
    if (nextBtn) await user.click(nextBtn);
    expect(screen.getByText(/Back/)).toBeTruthy();
  });

  it('calls onCancel when X button clicked', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(React.createElement(AgentCreateFlow, {
      onComplete: vi.fn(),
      onCancel,
    }));
    const cancelBtn = screen.getByLabelText('Cancel agent creation');
    await user.click(cancelBtn);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('shows step indicator with correct number of steps', () => {
    render(React.createElement(AgentCreateFlow, {
      onComplete: vi.fn(),
      onCancel: vi.fn(),
    }));
    expect(screen.getByText(/Step 1 of 7/)).toBeTruthy();
  });

  it('shows Review text on final step label', async () => {
    render(React.createElement(AgentCreateFlow, {
      onComplete: vi.fn(),
      onCancel: vi.fn(),
    }));
    // Step 7 label in the step indicator should say Review
    // We check the steps include "Review" (visible in aria-labels)
    const reviewStep = screen.queryByLabelText(/Step 7.*Review/);
    expect(reviewStep).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// SpendPolicyEditor tests
// ---------------------------------------------------------------------------

describe('SpendPolicyEditor', () => {
  let SpendPolicyEditor: typeof import('../../src/components/agents/SpendPolicyEditor').default;

  beforeEach(async () => {
    const module = await import('../../src/components/agents/SpendPolicyEditor');
    SpendPolicyEditor = module.default;
  });

  it('renders all sliders', () => {
    render(React.createElement(SpendPolicyEditor, {
      value: MOCK_SPEND_POLICY,
      onChange: vi.fn(),
    }));
    expect(screen.getByLabelText(/Max Single Spend/)).toBeTruthy();
    expect(screen.getByLabelText(/Daily Limit/)).toBeTruthy();
    expect(screen.getByLabelText(/Approval Threshold/)).toBeTruthy();
  });

  it('displays correct sat amounts', () => {
    render(React.createElement(SpendPolicyEditor, {
      value: MOCK_SPEND_POLICY,
      onChange: vi.fn(),
    }));
    // 10,000,000 msats = 10,000 sats
    expect(screen.getByText('10,000 sats')).toBeTruthy();
    // 100,000,000 msats = 100,000 sats
    expect(screen.getByText('100,000 sats')).toBeTruthy();
  });

  it('renders rail toggle with three options', () => {
    render(React.createElement(SpendPolicyEditor, {
      value: MOCK_SPEND_POLICY,
      onChange: vi.fn(),
    }));
    expect(screen.getByRole('radio', { name: /Lightning/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Cashu/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Auto/ })).toBeTruthy();
  });

  it('calls onChange when rail toggled', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(React.createElement(SpendPolicyEditor, {
      value: MOCK_SPEND_POLICY,
      onChange,
    }));
    const lightningBtn = screen.getByRole('radio', { name: /Lightning/ });
    await user.click(lightningBtn);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ preferred_spend_rail: 'lightning' })
    );
  });

  it('disables all inputs when disabled prop set', () => {
    render(React.createElement(SpendPolicyEditor, {
      value: MOCK_SPEND_POLICY,
      onChange: vi.fn(),
      disabled: true,
    }));
    const sliders = screen.getAllByRole('slider');
    sliders.forEach(slider => {
      expect((slider as HTMLInputElement).disabled).toBe(true);
    });
  });

  it('adds mint to allowed_mints when entered', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(React.createElement(SpendPolicyEditor, {
      value: MOCK_SPEND_POLICY,
      onChange,
    }));
    const mintInput = screen.getByLabelText('New mint URL');
    await user.type(mintInput, 'https://mint.example.com');
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        allowed_mints: ['https://mint.example.com']
      })
    );
  });

  it('renders sweep threshold input', () => {
    render(React.createElement(SpendPolicyEditor, {
      value: MOCK_SPEND_POLICY,
      onChange: vi.fn(),
    }));
    expect(screen.getByLabelText('Sweep Threshold (sats)')).toBeTruthy();
  });

  it('renders sweep destination input', () => {
    render(React.createElement(SpendPolicyEditor, {
      value: MOCK_SPEND_POLICY,
      onChange: vi.fn(),
    }));
    expect(screen.getByLabelText('Sweep Destination')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// AgentMonitoringPanel tests
// ---------------------------------------------------------------------------

describe('AgentMonitoringPanel', () => {
  let AgentMonitoringPanel: typeof import('../../src/components/agents/AgentMonitoringPanel').default;

  beforeEach(async () => {
    const module = await import('../../src/components/agents/AgentMonitoringPanel');
    AgentMonitoringPanel = module.default;
  });

  it('renders heartbeat as healthy when recent', () => {
    const recentAgent = { ...MOCK_AGENT, lastHeartbeat: Math.floor(Date.now() / 1000) - 10 };
    render(React.createElement(AgentMonitoringPanel, { agent: recentAgent }));
    expect(screen.getByText('Healthy')).toBeTruthy();
  });

  it('renders heartbeat as delayed when 2-5 minutes old', () => {
    const delayedAgent = { ...MOCK_AGENT, lastHeartbeat: Math.floor(Date.now() / 1000) - 180 };
    render(React.createElement(AgentMonitoringPanel, { agent: delayedAgent }));
    expect(screen.getByText('Delayed')).toBeTruthy();
  });

  it('renders heartbeat as offline when >5 minutes old', () => {
    const offlineAgent = { ...MOCK_AGENT, lastHeartbeat: Math.floor(Date.now() / 1000) - 600 };
    render(React.createElement(AgentMonitoringPanel, { agent: offlineAgent }));
    expect(screen.getByText('Offline')).toBeTruthy();
  });

  it('renders monitoring section label', () => {
    render(React.createElement(AgentMonitoringPanel, { agent: MOCK_AGENT }));
    expect(screen.getByText('Monitoring')).toBeTruthy();
  });

  it('renders task performance bar chart', () => {
    render(React.createElement(AgentMonitoringPanel, { agent: MOCK_AGENT }));
    expect(screen.getByText('Task Performance')).toBeTruthy();
  });

  it('renders error log section when errors present', () => {
    const errorAgent = { ...MOCK_AGENT, errorLog: ['Connection timeout', 'API rate limit exceeded'] };
    render(React.createElement(AgentMonitoringPanel, { agent: errorAgent }));
    expect(screen.getByText('Error Log')).toBeTruthy();
    expect(screen.getByText('Connection timeout')).toBeTruthy();
  });
});
