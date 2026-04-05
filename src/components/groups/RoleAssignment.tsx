/**
 * @component RoleAssignment
 * @description Guardian/Steward assigns roles to members via NIP-26 delegation events.
 *
 * Allows an authorized user to:
 * 1. Select a role to assign
 * 2. Configure delegation conditions (allowed kinds, expiry)
 * 3. Sign and publish the NIP-26 delegation event
 */

import React, { useState } from 'react';
import { RoleType } from '../../lib/nip26/types.js';
import { constructRoleDelegation } from '../../lib/nip26/construct.js';
import type { DelegationEvent } from '../../lib/nip26/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RoleAssignmentProps {
  /** Hex pubkey of the member receiving the role */
  delegateePubkey: string;
  /** Display name of the delegatee */
  delegateeDisplayName?: string;
  /** Current role of the assigner */
  assignerRole: RoleType;
  /** Called with the created delegation event on success */
  onAssigned?: (delegation: DelegationEvent) => void;
  /** Called when the user cancels */
  onCancel?: () => void;
}

// ---------------------------------------------------------------------------
// Role options available to each assigner role
// ---------------------------------------------------------------------------

const ASSIGNABLE_ROLES: Record<RoleType, RoleType[]> = {
  [RoleType.Guardian]: [RoleType.Steward, RoleType.Adult, RoleType.Offspring],
  [RoleType.Steward]:  [RoleType.Adult, RoleType.Offspring],
  [RoleType.Adult]:    [], // Cannot delegate
  [RoleType.Offspring]: [], // Cannot delegate
};

const ROLE_DESCRIPTIONS: Record<RoleType, string> = {
  [RoleType.Guardian]:  'Full authority — can create groups, manage members, and initiate ceremonies',
  [RoleType.Steward]:   'Operational authority — can manage members, sign delegations',
  [RoleType.Adult]:     'Spending authority within policy limits — can create agents',
  [RoleType.Offspring]: 'Restricted — most operations require approval',
};

const ROLE_ICONS: Record<RoleType, string> = {
  [RoleType.Guardian]:  '🛡',
  [RoleType.Steward]:   '⚖',
  [RoleType.Adult]:     '👤',
  [RoleType.Offspring]: '🌱',
};

const ROLE_COLORS: Record<RoleType, string> = {
  [RoleType.Guardian]:  'border-[#F7931A]/40 text-[#F7931A]',
  [RoleType.Steward]:   'border-[#FFD700]/40 text-[#FFD700]',
  [RoleType.Adult]:     'border-[#3B82F6]/40 text-[#3B82F6]',
  [RoleType.Offspring]: 'border-[#a0a0a0]/40 text-[#a0a0a0]',
};

// ---------------------------------------------------------------------------
// Expiry options
// ---------------------------------------------------------------------------

const EXPIRY_OPTIONS = [
  { label: '30 days',  value: 30 * 24 * 3600 },
  { label: '90 days',  value: 90 * 24 * 3600 },
  { label: '1 year',   value: 365 * 24 * 3600 },
  { label: '2 years',  value: 2 * 365 * 24 * 3600 },
  { label: 'No expiry', value: 0 },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function RoleAssignment({
  delegateePubkey,
  delegateeDisplayName,
  assignerRole,
  onAssigned,
  onCancel,
}: RoleAssignmentProps) {
  const assignableRoles = ASSIGNABLE_ROLES[assignerRole];
  const [selectedRole, setSelectedRole] = useState<RoleType | null>(
    assignableRoles[0] ?? null,
  );
  const [expiryOffset, setExpiryOffset] = useState(EXPIRY_OPTIONS[2].value); // 1 year default
  const [signerNsec, setSignerNsec] = useState('');
  const [status, setStatus] = useState<'idle' | 'signing' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const shortPubkey = delegateePubkey.slice(0, 12) + '…' + delegateePubkey.slice(-8);
  const displayName = delegateeDisplayName ?? shortPubkey;

  const canSubmit = selectedRole !== null && signerNsec.length >= 63;

  const handleAssign = async () => {
    if (!selectedRole || !signerNsec) return;
    setStatus('signing');
    setErrorMessage('');

    try {
      const expiry = expiryOffset > 0
        ? Math.floor(Date.now() / 1000) + expiryOffset
        : undefined;

      const delegation = constructRoleDelegation(
        signerNsec,
        delegateePubkey,
        selectedRole,
        expiry,
      );

      setStatus('success');
      onAssigned?.(delegation);
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Signing failed');
    }
  };

  if (assignableRoles.length === 0) {
    return (
      <div className="card text-center py-8">
        <p className="text-[#555555] text-sm">Your role does not permit assigning roles.</p>
        {onCancel && (
          <button onClick={onCancel} className="mt-4 btn-ghost text-sm">
            Close
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="card space-y-6" role="dialog" aria-label="Assign role">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg text-[#F7931A] tracking-wider uppercase">
          Assign Role
        </h3>
        {onCancel && (
          <button
            onClick={onCancel}
            className="text-[#555555] hover:text-[#a0a0a0] text-xl leading-none"
            aria-label="Cancel"
          >
            ×
          </button>
        )}
      </div>

      {/* Target member */}
      <div className="flex items-center gap-3 p-3 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a]">
        <div className="w-9 h-9 rounded-full bg-[#2a2a2a] flex items-center justify-center text-base">
          👤
        </div>
        <div>
          <p className="font-medium text-[#f5f5f5] text-sm">{displayName}</p>
          <p className="font-mono text-xs text-[#555555]">{shortPubkey}</p>
        </div>
      </div>

      {/* Role selection */}
      <div>
        <label className="block text-sm font-medium text-[#a0a0a0] mb-3">
          Assign Role
        </label>
        <div className="space-y-2">
          {assignableRoles.map(role => (
            <button
              key={role}
              onClick={() => setSelectedRole(role)}
              className={`
                w-full flex items-start gap-3 p-3 rounded-lg border
                transition-all duration-150 text-left
                ${selectedRole === role
                  ? `${ROLE_COLORS[role]} bg-[#1a1a1a]`
                  : 'border-[#2a2a2a] hover:border-[#3a3a3a] text-[#a0a0a0]'
                }
              `}
              aria-pressed={selectedRole === role}
            >
              <span className="text-xl mt-0.5">{ROLE_ICONS[role]}</span>
              <div>
                <p className={`font-semibold text-sm capitalize ${selectedRole === role ? '' : 'text-[#f5f5f5]'}`}>
                  {role}
                </p>
                <p className="text-xs text-[#555555] mt-0.5">{ROLE_DESCRIPTIONS[role]}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Expiry */}
      <div>
        <label htmlFor="expiry-select" className="block text-sm font-medium text-[#a0a0a0] mb-2">
          Delegation Expiry
        </label>
        <select
          id="expiry-select"
          value={expiryOffset}
          onChange={e => setExpiryOffset(Number(e.target.value))}
          className="
            w-full px-4 py-3 rounded-lg
            bg-[#1a1a1a] border border-[#2a2a2a]
            text-[#f5f5f5]
            focus:outline-none focus:border-[#F7931A]
            transition-colors
          "
        >
          {EXPIRY_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Signer nsec */}
      <div>
        <label htmlFor="signer-nsec" className="block text-sm font-medium text-[#a0a0a0] mb-2">
          Your Secret Key (nsec) <span className="text-[#F7931A]">*</span>
        </label>
        <input
          id="signer-nsec"
          type="password"
          value={signerNsec}
          onChange={e => setSignerNsec(e.target.value)}
          placeholder="nsec1…"
          className="
            w-full px-4 py-3 rounded-lg
            bg-[#1a1a1a] border border-[#2a2a2a]
            text-[#f5f5f5] placeholder-[#555555] font-mono text-sm
            focus:outline-none focus:border-[#F7931A]
            transition-colors
          "
          aria-required="true"
          autoComplete="off"
        />
        <p className="mt-1 text-xs text-[#555555]">
          Used locally to sign the delegation. Never transmitted.
        </p>
      </div>

      {/* Error */}
      {status === 'error' && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20" role="alert">
          <p className="text-sm text-red-400">{errorMessage}</p>
        </div>
      )}

      {/* Success */}
      {status === 'success' && (
        <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20" role="status">
          <p className="text-sm text-green-400">✓ Role assigned successfully</p>
        </div>
      )}

      {/* Submit */}
      {status !== 'success' && (
        <button
          onClick={handleAssign}
          disabled={!canSubmit || status === 'signing'}
          className="
            w-full py-3 rounded-lg font-medium
            bg-[#F7931A] text-black
            hover:bg-[#c46e00] disabled:opacity-40 disabled:cursor-not-allowed
            transition-colors duration-150
          "
        >
          {status === 'signing' ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 rounded-full border-2 border-black/30 border-t-black animate-spin" />
              Signing…
            </span>
          ) : (
            `Assign ${selectedRole?.charAt(0).toUpperCase()}${selectedRole?.slice(1)} Role`
          )}
        </button>
      )}
    </div>
  );
}
