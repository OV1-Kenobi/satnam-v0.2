// Ported from v1 src/components/NWCWalletSetupModal.tsx
// Stripped: useAuth hook (JWT-backed), Supabase URI storage via addConnection()
// v2: URI stored in OPFS Vault — caller passes onSuccess(uri) and handles vault write
//   useNWCWallet hook's addConnection() is expected to write to OPFS Vault in v2

/**
 * NWC Wallet Setup Modal
 *
 * Educational onboarding flow for connecting a self-custodial Lightning wallet
 * via Nostr Wallet Connect (NIP-47).
 *
 * v2 key changes:
 * - Removed: useAuth() (JWT-based role checking)
 * - Removed: Supabase URI storage in addConnection()
 * - v2: URI stored in OPFS Vault — see comment in handleConnectionSubmit
 * - groupRole replaces userRole for display logic (spec §0.2)
 */

import {
  AlertCircle,
  ArrowRight,
  CheckCircle,
  Crown,
  ExternalLink,
  Globe,
  Info,
  Loader2,
  Shield,
  X,
  Zap,
} from "lucide-react";
import React, { useEffect, useState } from "react";

interface NWCWalletSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the validated NWC URI — caller writes to OPFS Vault */
  onSuccess?: (nwcUri: string) => void;
  showEducationalContent?: boolean;
  /** v2: groupRole replaces userRole (JWT-derived) */
  groupRole?: "offspring" | "adult" | "steward" | "guardian" | "private";
}

type SetupStep = "education" | "wallet-selection" | "connection" | "success";

interface RecommendedWallet {
  id: string;
  name: string;
  description: string;
  platform: "mobile" | "desktop" | "both";
  website: string;
  setupGuide: string;
  icon: React.ReactNode;
  features: string[];
  sovereignty: "high" | "medium" | "low";
}

const recommendedWallets: RecommendedWallet[] = [
  {
    id: "zeus",
    name: "Zeus LN",
    description: "Self-custodial Lightning wallet with full node capabilities",
    platform: "mobile",
    website: "https://zeusln.com",
    setupGuide: "Connect your own Lightning node or use embedded LND",
    icon: <Zap className="h-6 w-6 text-yellow-500" />,
    features: ["Self-custodial", "Full Lightning node", "NWC support", "Advanced features"],
    sovereignty: "high",
  },
  {
    id: "alby",
    name: "Alby Browser Extension",
    description: "Lightning wallet browser extension with NWC support",
    platform: "desktop",
    website: "https://getalby.com",
    setupGuide: "Install browser extension and connect to your Lightning node",
    icon: <Globe className="h-6 w-6 text-orange-500" />,
    features: ["Browser integration", "NWC support", "Easy setup", "Web payments"],
    sovereignty: "high",
  },
];

export default function NWCWalletSetupModal({
  isOpen,
  onClose,
  onSuccess,
  showEducationalContent = true,
  groupRole,
}: NWCWalletSetupModalProps) {
  const [currentStep, setCurrentStep] = useState<SetupStep>("education");
  const [selectedWallet, setSelectedWallet] = useState<RecommendedWallet | null>(null);
  const [connectionString, setConnectionString] = useState("");
  const [walletName, setWalletName] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setCurrentStep(showEducationalContent ? "education" : "wallet-selection");
      setSelectedWallet(null);
      setConnectionString("");
      setWalletName("");
      setIsConnecting(false);
      setError(null);
    }
  }, [isOpen, showEducationalContent]);

  const handleWalletSelection = (wallet: RecommendedWallet) => {
    setSelectedWallet(wallet);
    setWalletName(`${wallet.name} Wallet`);
    setCurrentStep("connection");
  };

  const handleConnectionSubmit = async () => {
    if (!connectionString.trim() || !selectedWallet) return;

    setIsConnecting(true);
    setError(null);

    try {
      // Basic URI validation
      if (!connectionString.trim().startsWith("nostr+walletconnect://")) {
        throw new Error('Invalid NWC URI — must start with "nostr+walletconnect://"');
      }

      // v2: URI stored in OPFS Vault — caller handles vault write via onSuccess
      setCurrentStep("success");
      onSuccess?.(connectionString.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setIsConnecting(false);
    }
  };

  const renderEducationStep = () => (
    <div className="space-y-6">
      <div className="text-center">
        <div className="mx-auto w-16 h-16 bg-gradient-to-br from-purple-500 to-blue-600 rounded-full flex items-center justify-center mb-4">
          <Crown className="h-8 w-8 text-white" />
        </div>
        <h3 className="text-2xl font-bold text-white mb-2">
          Achieve Financial Sovereignty
        </h3>
        <p className="text-gray-300">
          Connect your self-custodial Lightning wallet for true financial independence
        </p>
      </div>

      <div className="bg-gradient-to-r from-purple-900/30 to-blue-900/30 rounded-xl p-6 border border-purple-500/20">
        <h4 className="text-lg font-semibold text-white mb-4 flex items-center">
          <Shield className="h-5 w-5 text-purple-400 mr-2" />
          Why NWC (Nostr Wallet Connect)?
        </h4>
        <div className="space-y-3 text-gray-300">
          <div className="flex items-start space-x-3">
            <CheckCircle className="h-5 w-5 text-green-400 mt-0.5 flex-shrink-0" />
            <div>
              <strong className="text-white">Self-Custody:</strong> You control
              your private keys and funds
            </div>
          </div>
          <div className="flex items-start space-x-3">
            <CheckCircle className="h-5 w-5 text-green-400 mt-0.5 flex-shrink-0" />
            <div>
              <strong className="text-white">Privacy:</strong> Your NWC URI is
              stored only in your OPFS Vault on this device
            </div>
          </div>
          <div className="flex items-start space-x-3">
            <CheckCircle className="h-5 w-5 text-green-400 mt-0.5 flex-shrink-0" />
            <div>
              <strong className="text-white">Sovereignty:</strong>{" "}
              {groupRole === "offspring"
                ? "Build financial independence with guardian guidance"
                : "Unlimited spending authority with no restrictions"}
            </div>
          </div>
          <div className="flex items-start space-x-3">
            <CheckCircle className="h-5 w-5 text-green-400 mt-0.5 flex-shrink-0" />
            <div>
              <strong className="text-white">Integration:</strong> Seamless
              payments across all Satnam features
            </div>
          </div>
        </div>
      </div>

      {groupRole === "offspring" && (
        <div className="bg-blue-900/30 rounded-xl p-4 border border-blue-500/20">
          <div className="flex items-start space-x-3">
            <Info className="h-5 w-5 text-blue-400 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-blue-200">
              <strong>For Young Adults:</strong> Your NWC wallet will have
              spending limits and require guardian approval for large payments
              (over 25K sats) as part of your financial education journey.
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-between">
        <button
          onClick={onClose}
          className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
        >
          Maybe Later
        </button>
        <button
          onClick={() => setCurrentStep("wallet-selection")}
          className="flex items-center space-x-2 px-6 py-2 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 rounded-lg text-white font-medium transition-all"
        >
          <span>Get Started</span>
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  const renderWalletSelectionStep = () => (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-xl font-bold text-white mb-2">
          Choose Your Lightning Wallet
        </h3>
        <p className="text-gray-300">
          Select a recommended self-custodial wallet for maximum sovereignty
        </p>
      </div>

      <div className="space-y-4">
        {recommendedWallets.map((wallet) => (
          <div
            key={wallet.id}
            onClick={() => handleWalletSelection(wallet)}
            className={`p-6 rounded-xl border-2 cursor-pointer transition-all ${
              selectedWallet?.id === wallet.id
                ? "border-purple-500 bg-purple-900/20"
                : "border-gray-700 hover:border-gray-600 bg-gray-800/30"
            }`}
          >
            <div className="flex items-start space-x-4">
              <div className="p-3 bg-gray-700/50 rounded-lg">{wallet.icon}</div>
              <div className="flex-1">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-lg font-semibold text-white">
                    {wallet.name}
                  </h4>
                  <span
                    className={`px-2 py-1 rounded-full text-xs font-medium ${
                      wallet.sovereignty === "high"
                        ? "bg-green-900/30 text-green-300 border border-green-500/20"
                        : "bg-yellow-900/30 text-yellow-300 border border-yellow-500/20"
                    }`}
                  >
                    {wallet.sovereignty === "high"
                      ? "High Sovereignty"
                      : "Medium Sovereignty"}
                  </span>
                </div>
                <p className="text-gray-300 mb-3">{wallet.description}</p>
                <div className="flex flex-wrap gap-2 mb-3">
                  {wallet.features.map((feature) => (
                    <span
                      key={feature}
                      className="px-2 py-1 bg-gray-700/30 text-gray-300 rounded text-xs"
                    >
                      {feature}
                    </span>
                  ))}
                </div>
                <a
                  href={wallet.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center space-x-1 text-blue-400 hover:text-blue-300 text-sm"
                >
                  <span>Visit Website</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-between">
        <button
          onClick={() => setCurrentStep("education")}
          className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
        >
          Back
        </button>
        <button
          onClick={onClose}
          className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );

  const renderConnectionStep = () => (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-xl font-bold text-white mb-2">
          Connect {selectedWallet?.name}
        </h3>
        <p className="text-gray-300">
          Enter your NWC connection string. It will be stored in your OPFS
          Vault — never on a server.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Wallet Name
          </label>
          <input
            type="text"
            value={walletName}
            onChange={(e) => setWalletName(e.target.value)}
            placeholder={`${selectedWallet?.name} Wallet`}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            NWC Connection String
          </label>
          <textarea
            value={connectionString}
            onChange={(e) => setConnectionString(e.target.value)}
            placeholder="nostr+walletconnect://..."
            rows={3}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          />
        </div>

        {error && (
          <div className="flex items-center space-x-2 text-red-400 text-sm">
            <AlertCircle className="h-4 w-4" />
            <span>{error}</span>
          </div>
        )}
      </div>

      <div className="flex justify-between">
        <button
          onClick={() => setCurrentStep("wallet-selection")}
          className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
        >
          Back
        </button>
        <button
          onClick={handleConnectionSubmit}
          disabled={!connectionString.trim() || isConnecting}
          className="flex items-center space-x-2 px-6 py-2 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white font-medium transition-all"
        >
          {isConnecting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Connecting...</span>
            </>
          ) : (
            <>
              <span>Connect</span>
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>
      </div>
    </div>
  );

  const renderSuccessStep = () => (
    <div className="space-y-6 text-center">
      <div className="mx-auto w-16 h-16 bg-gradient-to-br from-green-500 to-emerald-600 rounded-full flex items-center justify-center mb-4">
        <CheckCircle className="h-8 w-8 text-white" />
      </div>
      <h3 className="text-2xl font-bold text-white">Wallet Connected!</h3>
      <p className="text-gray-300">
        Your {selectedWallet?.name} wallet has been connected and the URI
        stored securely in your OPFS Vault.
      </p>
      <button
        onClick={onClose}
        className="w-full px-6 py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 rounded-lg text-white font-medium transition-all"
      >
        Done
      </button>
    </div>
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-gray-900 rounded-xl shadow-2xl border border-gray-700 p-6 max-w-lg w-full mx-4 relative max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-200 transition-colors"
          aria-label="Close modal"
        >
          <X className="h-6 w-6" />
        </button>

        {currentStep === "education" && renderEducationStep()}
        {currentStep === "wallet-selection" && renderWalletSelectionStep()}
        {currentStep === "connection" && renderConnectionStep()}
        {currentStep === "success" && renderSuccessStep()}
      </div>
    </div>
  );
}
