/**
 * @module components/payments/CascadeBuilder
 * @description Visual cascade tree builder for split payments.
 *
 * Each node represents a payment recipient with:
 * - Recipient identifier (pubkey, LN address, or alias)
 * - Allocation: percentage or fixed amount
 * - Rail: lightning, cashu, lnbits
 *
 * Live validation: percentages must sum to ≤ 100%.
 * Preview: shows how a given total would distribute.
 * Save as template for recurring use.
 */

import React, { useState, useCallback, useId } from 'react';
import clsx from 'clsx';
import {
  Plus,
  Trash2,
  GitBranch,
  CheckCircle2,
  AlertCircle,
  Save,
  Play,
  ChevronDown,
  Zap,
  Coins,
  Server,
  Edit2,
  Copy,
  X,
} from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

type Rail = 'lightning' | 'cashu' | 'lnbits';
type AllocMode = 'percentage' | 'fixed';

interface CascadeNode {
  id: string;
  recipient: string;
  allocMode: AllocMode;
  percentage: number;
  fixedSats: number;
  rail: Rail;
  label: string;
}

interface CascadeTemplate {
  id: string;
  name: string;
  nodes: CascadeNode[];
  createdAt: number;
}

// ============================================================================
// Constants
// ============================================================================

const RAIL_META: Record<Rail, { label: string; color: string; icon: typeof Zap }> = {
  lightning: { label: 'Lightning', color: '#f7931a', icon: Zap },
  cashu: { label: 'Cashu', color: '#a855f7', icon: Coins },
  lnbits: { label: 'LNbits', color: '#22c55e', icon: Server },
};

let nodeCounter = 1;
function generateNodeId() {
  return `node-${Date.now()}-${nodeCounter++}`;
}

function createDefaultNode(): CascadeNode {
  return {
    id: generateNodeId(),
    recipient: '',
    allocMode: 'percentage',
    percentage: 0,
    fixedSats: 0,
    rail: 'lightning',
    label: '',
  };
}

// ============================================================================
// Validation
// ============================================================================

interface ValidationResult {
  valid: boolean;
  errors: Record<string, string>;
  totalPct: number;
  warnings: string[];
}

function validateNodes(nodes: CascadeNode[]): ValidationResult {
  const errors: Record<string, string> = {};
  const warnings: string[] = [];

  const pctNodes = nodes.filter((n) => n.allocMode === 'percentage');
  const totalPct = pctNodes.reduce((s, n) => s + n.percentage, 0);

  if (totalPct > 100) {
    warnings.push(`Percentage nodes sum to ${totalPct.toFixed(1)}% — exceeds 100%`);
  }

  nodes.forEach((node) => {
    if (!node.recipient.trim()) {
      errors[`${node.id}-recipient`] = 'Recipient required';
    }
    if (node.allocMode === 'percentage') {
      if (node.percentage <= 0 || node.percentage > 100) {
        errors[`${node.id}-pct`] = 'Must be 1–100%';
      }
    } else {
      if (node.fixedSats <= 0) {
        errors[`${node.id}-fixed`] = 'Must be > 0 sats';
      }
    }
  });

  return {
    valid: Object.keys(errors).length === 0 && totalPct <= 100,
    errors,
    totalPct,
    warnings,
  };
}

// ============================================================================
// Distribution preview
// ============================================================================

function computeDistribution(
  nodes: CascadeNode[],
  totalSats: number
): Array<{ node: CascadeNode; sats: number }> {
  let remaining = totalSats;

  // Fixed nodes first
  const fixed = nodes
    .filter((n) => n.allocMode === 'fixed')
    .map((n) => ({ node: n, sats: n.fixedSats }));

  remaining -= fixed.reduce((s, f) => s + f.sats, 0);
  if (remaining < 0) remaining = 0;

  // Percentage nodes from remaining
  const pct = nodes
    .filter((n) => n.allocMode === 'percentage')
    .map((n) => ({ node: n, sats: Math.floor((n.percentage / 100) * remaining) }));

  return [...fixed, ...pct];
}

// ============================================================================
// Node Editor
// ============================================================================

interface NodeEditorProps {
  node: CascadeNode;
  index: number;
  errors: Record<string, string>;
  onChange: (id: string, patch: Partial<CascadeNode>) => void;
  onRemove: (id: string) => void;
  totalNodes: number;
}

function NodeEditor({ node, index, errors, onChange, onRemove, totalNodes }: NodeEditorProps) {
  const meta = RAIL_META[node.rail];
  const idPrefix = `node-${node.id}`;

  return (
    <div
      className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3"
      aria-label={`Cascade node ${index + 1}`}
    >
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
            style={{ backgroundColor: `${meta.color}30`, color: meta.color }}
            aria-hidden="true"
          >
            {index + 1}
          </div>
          <span className="text-xs text-slate-400">Node {index + 1}</span>
        </div>
        {totalNodes > 1 && (
          <button
            type="button"
            onClick={() => onRemove(node.id)}
            aria-label={`Remove node ${index + 1}`}
            className="p-1 rounded-lg hover:bg-red-500/10 hover:text-red-400 text-slate-500 transition-colors"
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Recipient */}
      <div>
        <label htmlFor={`${idPrefix}-recipient`} className="block text-xs text-slate-400 mb-1">
          Recipient <span className="text-red-400">*</span>
        </label>
        <input
          id={`${idPrefix}-recipient`}
          type="text"
          value={node.recipient}
          onChange={(e) => onChange(node.id, { recipient: e.target.value })}
          placeholder="npub1... or user@domain.com"
          className={clsx(
            'w-full px-3 py-2 rounded-lg bg-slate-900 border text-sm text-slate-200 placeholder-slate-600',
            'focus:outline-none focus:border-[#f7931a] transition-colors',
            errors[`${node.id}-recipient`] ? 'border-red-500' : 'border-slate-700'
          )}
          aria-invalid={!!errors[`${node.id}-recipient`]}
          aria-describedby={errors[`${node.id}-recipient`] ? `${idPrefix}-recipient-err` : undefined}
        />
        {errors[`${node.id}-recipient`] && (
          <p id={`${idPrefix}-recipient-err`} className="text-xs text-red-400 mt-1">
            {errors[`${node.id}-recipient`]}
          </p>
        )}
      </div>

      {/* Label (optional) */}
      <div>
        <label htmlFor={`${idPrefix}-label`} className="block text-xs text-slate-400 mb-1">
          Label <span className="text-slate-600">(optional)</span>
        </label>
        <input
          id={`${idPrefix}-label`}
          type="text"
          value={node.label}
          onChange={(e) => onChange(node.id, { label: e.target.value })}
          placeholder="e.g. Creator fee, Agent payout"
          className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-[#f7931a] transition-colors"
        />
      </div>

      {/* Allocation mode + value */}
      <div className="flex gap-2">
        {/* Mode toggle */}
        <div className="flex rounded-lg border border-slate-700 overflow-hidden flex-shrink-0">
          {(['percentage', 'fixed'] as AllocMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onChange(node.id, { allocMode: mode })}
              aria-pressed={node.allocMode === mode}
              className={clsx(
                'px-2.5 py-1.5 text-xs transition-colors',
                node.allocMode === mode
                  ? 'bg-[#f7931a] text-black font-medium'
                  : 'text-slate-400 hover:text-slate-300'
              )}
            >
              {mode === 'percentage' ? '%' : 'sats'}
            </button>
          ))}
        </div>

        {/* Value input */}
        {node.allocMode === 'percentage' ? (
          <div className="flex-1">
            <input
              type="number"
              min={0.1}
              max={100}
              step={0.1}
              value={node.percentage || ''}
              onChange={(e) => onChange(node.id, { percentage: parseFloat(e.target.value) || 0 })}
              placeholder="0–100"
              aria-label="Percentage allocation"
              className={clsx(
                'w-full px-3 py-2 rounded-lg bg-slate-900 border text-sm text-slate-200 placeholder-slate-600',
                'focus:outline-none focus:border-[#f7931a] transition-colors',
                errors[`${node.id}-pct`] ? 'border-red-500' : 'border-slate-700'
              )}
            />
            {errors[`${node.id}-pct`] && (
              <p className="text-xs text-red-400 mt-1">{errors[`${node.id}-pct`]}</p>
            )}
          </div>
        ) : (
          <div className="flex-1">
            <input
              type="number"
              min={1}
              step={1}
              value={node.fixedSats || ''}
              onChange={(e) => onChange(node.id, { fixedSats: parseInt(e.target.value, 10) || 0 })}
              placeholder="Fixed sats"
              aria-label="Fixed sats allocation"
              className={clsx(
                'w-full px-3 py-2 rounded-lg bg-slate-900 border text-sm text-slate-200 placeholder-slate-600',
                'focus:outline-none focus:border-[#f7931a] transition-colors',
                errors[`${node.id}-fixed`] ? 'border-red-500' : 'border-slate-700'
              )}
            />
            {errors[`${node.id}-fixed`] && (
              <p className="text-xs text-red-400 mt-1">{errors[`${node.id}-fixed`]}</p>
            )}
          </div>
        )}
      </div>

      {/* Rail selector */}
      <div>
        <p className="text-xs text-slate-400 mb-1.5">Payment rail</p>
        <div className="flex gap-2">
          {(Object.keys(RAIL_META) as Rail[]).map((rail) => {
            const m = RAIL_META[rail];
            return (
              <button
                key={rail}
                type="button"
                onClick={() => onChange(node.id, { rail })}
                aria-pressed={node.rail === rail}
                className={clsx(
                  'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border text-xs transition-colors',
                  node.rail === rail
                    ? 'border-transparent font-medium'
                    : 'border-slate-700 text-slate-500 hover:border-slate-600'
                )}
                style={node.rail === rail ? {
                  backgroundColor: `${m.color}20`,
                  borderColor: `${m.color}50`,
                  color: m.color,
                } : {}}
              >
                <m.icon size={11} aria-hidden="true" />
                {m.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export interface CascadeBuilderProps {
  onExecute?: (nodes: CascadeNode[], totalSats: number) => void;
  className?: string;
}

export default function CascadeBuilder({ onExecute, className }: CascadeBuilderProps) {
  const [nodes, setNodes] = useState<CascadeNode[]>([
    { ...createDefaultNode(), recipient: '', percentage: 50, rail: 'lightning' },
    { ...createDefaultNode(), recipient: '', percentage: 50, rail: 'cashu' },
  ]);
  const [previewAmount, setPreviewAmount] = useState<number>(10_000);
  const [templates, setTemplates] = useState<CascadeTemplate[]>([]);
  const [templateName, setTemplateName] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [savedToast, setSavedToast] = useState(false);

  const validation = validateNodes(nodes);
  const distribution = computeDistribution(nodes, previewAmount);

  // ─── Node mutations ────────────────────────────────────────────────────────

  const addNode = useCallback(() => {
    setNodes((prev) => [...prev, createDefaultNode()]);
  }, []);

  const removeNode = useCallback((id: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const updateNode = useCallback((id: string, patch: Partial<CascadeNode>) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  }, []);

  // ─── Templates ─────────────────────────────────────────────────────────────

  const saveTemplate = useCallback(() => {
    if (!templateName.trim()) return;
    const tmpl: CascadeTemplate = {
      id: `tmpl-${Date.now()}`,
      name: templateName.trim(),
      nodes: nodes.map((n) => ({ ...n })),
      createdAt: Date.now(),
    };
    setTemplates((prev) => [...prev, tmpl]);
    setTemplateName('');
    setShowSaveDialog(false);
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 2000);
  }, [templateName, nodes]);

  const loadTemplate = useCallback((tmpl: CascadeTemplate) => {
    setNodes(tmpl.nodes.map((n) => ({ ...n, id: generateNodeId() })));
  }, []);

  // ─── Summary ───────────────────────────────────────────────────────────────

  const pctNodes = nodes.filter((n) => n.allocMode === 'percentage');
  const totalPct = pctNodes.reduce((s, n) => s + n.percentage, 0);
  const pctColor =
    totalPct > 100 ? 'text-red-400' :
    totalPct === 100 ? 'text-green-400' : 'text-yellow-400';

  return (
    <div className={clsx('space-y-4', className)}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <GitBranch size={16} className="text-[#ffd700]" aria-hidden="true" />
        <h2 className="heading-display text-lg text-[#ffd700] tracking-wider">
          Cascade Builder
        </h2>
      </div>

      {/* Validation summary */}
      <div
        className={clsx(
          'flex items-start gap-2 px-3 py-2 rounded-lg text-xs',
          validation.valid
            ? 'bg-green-500/10 border border-green-500/20 text-green-400'
            : 'bg-yellow-500/10 border border-yellow-500/20 text-yellow-400'
        )}
        role="status"
        aria-live="polite"
      >
        {validation.valid ? (
          <CheckCircle2 size={14} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
        ) : (
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
        )}
        <div>
          {validation.warnings.map((w, i) => <p key={i}>{w}</p>)}
          {validation.valid && <p>Cascade is valid — ready to execute</p>}
          {!validation.valid && validation.warnings.length === 0 && (
            <p>Fix errors above to continue</p>
          )}
        </div>
      </div>

      {/* Percentage total indicator */}
      {pctNodes.length > 0 && (
        <div className="flex items-center justify-between text-xs px-1">
          <span className="text-slate-500">% total</span>
          <div className="flex items-center gap-2">
            {/* Progress bar */}
            <div className="w-24 h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className={clsx(
                  'h-full rounded-full transition-all',
                  totalPct > 100 ? 'bg-red-400' :
                  totalPct === 100 ? 'bg-green-400' : 'bg-yellow-400'
                )}
                style={{ width: `${Math.min(100, totalPct)}%` }}
              />
            </div>
            <span className={clsx('font-mono font-medium', pctColor)}>
              {totalPct.toFixed(1)}%
            </span>
          </div>
        </div>
      )}

      {/* Node list */}
      <div className="space-y-3" role="list" aria-label="Cascade nodes">
        {nodes.map((node, idx) => (
          <div key={node.id} role="listitem">
            <NodeEditor
              node={node}
              index={idx}
              errors={validation.errors}
              onChange={updateNode}
              onRemove={removeNode}
              totalNodes={nodes.length}
            />
          </div>
        ))}
      </div>

      {/* Add node button */}
      <button
        type="button"
        onClick={addNode}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-slate-700 text-slate-500 hover:border-[#f7931a]/40 hover:text-[#f7931a] transition-colors text-sm"
        aria-label="Add cascade node"
      >
        <Plus size={16} aria-hidden="true" />
        Add Node
      </button>

      {/* Preview section */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <h3 className="text-xs text-slate-500 uppercase tracking-widest mb-3">
          Distribution Preview
        </h3>

        <div className="flex items-center gap-2 mb-4">
          <label htmlFor="preview-amount" className="text-xs text-slate-400 flex-shrink-0">
            If total is:
          </label>
          <input
            id="preview-amount"
            type="number"
            min={1}
            value={previewAmount}
            onChange={(e) => setPreviewAmount(parseInt(e.target.value, 10) || 1000)}
            className="w-full px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-200 font-mono focus:outline-none focus:border-[#f7931a] transition-colors"
            aria-label="Preview total sats"
          />
          <span className="text-xs text-slate-500 flex-shrink-0">sats</span>
        </div>

        <div className="space-y-2" role="list" aria-label="Distribution preview">
          {distribution.map(({ node, sats }, i) => {
            const meta = RAIL_META[node.rail];
            const pct = previewAmount > 0 ? (sats / previewAmount) * 100 : 0;
            return (
              <div key={node.id} role="listitem">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-slate-400 truncate max-w-[60%]">
                    {node.label || node.recipient || `Node ${i + 1}`}
                  </span>
                  <span className="font-mono font-medium" style={{ color: meta.color }}>
                    {sats.toLocaleString()} sats
                  </span>
                </div>
                <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.max(2, pct)}%`,
                      backgroundColor: meta.color,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Templates */}
      {templates.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <h3 className="text-xs text-slate-500 uppercase tracking-widest mb-3">Saved Templates</h3>
          <div className="space-y-2">
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => loadTemplate(t)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 transition-colors text-left"
                aria-label={`Load template: ${t.name}`}
              >
                <span className="text-sm text-slate-300">{t.name}</span>
                <span className="text-xs text-slate-500">{t.nodes.length} nodes</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setShowSaveDialog(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-700 text-slate-400 hover:border-slate-600 transition-colors text-sm"
          aria-label="Save cascade as template"
        >
          <Save size={14} aria-hidden="true" />
          Save
        </button>

        <button
          type="button"
          onClick={() => onExecute?.(nodes, previewAmount)}
          disabled={!validation.valid}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#f7931a] text-black font-medium text-sm hover:bg-[#c46e00] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          aria-label="Execute cascade payment"
        >
          <Play size={14} aria-hidden="true" />
          Execute Cascade
        </button>
      </div>

      {/* Save dialog */}
      {showSaveDialog && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Save cascade template"
        >
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 w-full max-w-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-slate-200">Save Template</h3>
              <button
                type="button"
                onClick={() => setShowSaveDialog(false)}
                aria-label="Close dialog"
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-500"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
            <input
              type="text"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="Template name"
              autoFocus
              className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-200 focus:outline-none focus:border-[#f7931a] transition-colors mb-3"
              onKeyDown={(e) => e.key === 'Enter' && saveTemplate()}
            />
            <button
              type="button"
              onClick={saveTemplate}
              disabled={!templateName.trim()}
              className="w-full py-2.5 rounded-lg bg-[#ffd700] text-black font-medium text-sm hover:bg-[#ccb000] disabled:opacity-40 transition-colors"
            >
              Save Template
            </button>
          </div>
        </div>
      )}

      {/* Saved toast */}
      {savedToast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-green-500 text-black text-xs font-medium px-4 py-2 rounded-full shadow-lg"
          role="status"
          aria-live="polite"
        >
          Template saved
        </div>
      )}
    </div>
  );
}
