// ─────────────────────────────────────────────────────────────
// app/settings/page.tsx — Settings Page for Wallet/Network Preferences
// ─────────────────────────────────────────────────────────────

"use client";

import { useState, useEffect } from "react";
import { useWalletContext } from "@/context/WalletContext";
import { 
  Settings, 
  Wallet, 
  Network, 
  Shield, 
  Globe, 
  Bell, 
  Eye, 
  EyeOff,
  Save,
  RefreshCw,
  Check,
  X,
  AlertTriangle,
  Info,
  ExternalLink
} from "lucide-react";

export default function SettingsPage() {
  const { 
    publicKey, 
    isConnected, 
    isWrongNetwork, 
    disconnect, 
    networkPassphrase,
    status 
  } = useWalletContext();

  // Derive a human-readable network name from the passphrase
  const network = networkPassphrase?.includes('Test SDF')
    ? 'testnet'
    : networkPassphrase?.includes('Public Global')
      ? 'public'
      : networkPassphrase
        ? 'futurenet'
        : 'public';

  const [settings, setSettings] = useState({
    // Network Settings
    preferredNetwork: network || 'public',
    autoSwitchNetwork: true,
    
    // Wallet Settings
    showBalance: true,
    showTransactionHistory: true,
    confirmTransactions: true,
    
    // Notification Settings
    priceAlerts: true,
    offerUpdates: true,
    auctionEndings: true,
    
    // Privacy Settings
    showProfilePublicly: true,
    shareActivityData: false,
    
    // Display Settings
    theme: 'dark',
    language: 'en',
    currency: 'XLM'
  });

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    // Simulate saving settings
    await new Promise(resolve => setTimeout(resolve, 1000));
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleNetworkSwitch = async (newNetwork: string) => {
    // Network switching is handled by the wallet extension (Freighter).
    // Here we just update local preference state.
    console.info('Network preference set to:', newNetwork);
    setSettings(prev => ({ ...prev, preferredNetwork: newNetwork }));
  };

  const networks = [
    { id: 'public', name: 'Stellar Public Network', description: 'Main network for real transactions' },
    { id: 'testnet', name: 'Stellar Testnet', description: 'Test network for development' },
    { id: 'futurenet', name: 'Stellar Futurenet', description: 'Future test network' }
  ];

  const currencies = [
    { code: 'XLM', name: 'Stellar Lumens' },
    { code: 'USD', name: 'US Dollar' },
    { code: 'EUR', name: 'Euro' },
    { code: 'NGN', name: 'Nigerian Naira' }
  ];

  const languages = [
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Español' },
    { code: 'fr', name: 'Français' },
    { code: 'pt', name: 'Português' },
    { code: 'sw', name: 'Kiswahili' }
  ];

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-midnight-950 pt-24">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <div className="text-center py-20">
            <Wallet className="mx-auto h-16 w-16 text-brand-400 mb-4" />
            <h1 className="text-2xl font-bold text-white mb-2">Connect Your Wallet</h1>
            <p className="text-gray-400 mb-6">You need to connect your wallet to access settings</p>
            <button
              onClick={() => window.location.href = '/'}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-500/25 hover:bg-brand-600"
            >
              Connect Wallet
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-midnight-950 pt-24">
      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Settings className="h-6 w-6 text-brand-400" />
            <h1 className="text-3xl font-bold text-white">Settings</h1>
          </div>
          <p className="text-gray-400">Manage your wallet, network, and application preferences</p>
        </div>

        {/* Network Status Card */}
        <div className="bg-midnight-900 rounded-xl border border-white/5 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Network className="h-5 w-5 text-brand-400" />
              <h2 className="text-lg font-semibold text-white">Network Status</h2>
            </div>
            {isWrongNetwork && (
              <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-terracotta-500/20 border border-terracotta-500/30 text-xs font-semibold text-terracotta-400">
                <AlertTriangle className="h-3 w-3" />
                Wrong Network
              </span>
            )}
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Current Network</label>
              <div className="grid grid-cols-1 gap-2">
                {networks.map((net) => (
                  <button
                    key={net.id}
                    onClick={() => handleNetworkSwitch(net.id)}
                    className={`flex items-center justify-between p-3 rounded-lg border transition-all ${
                      network === net.id
                        ? 'bg-brand-500/10 border-brand-500/30 text-brand-400'
                        : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
                    }`}
                  >
                    <div className="text-left">
                      <div className="font-medium">{net.name}</div>
                      <div className="text-xs opacity-70">{net.description}</div>
                    </div>
                    {network === net.id && <Check className="h-4 w-4" />}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
              <div>
                <div className="font-medium text-white">Auto-switch Network</div>
                <div className="text-xs text-gray-400">Automatically switch to the correct network</div>
              </div>
              <button
                onClick={() => setSettings(prev => ({ ...prev, autoSwitchNetwork: !prev.autoSwitchNetwork }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  settings.autoSwitchNetwork ? 'bg-brand-500' : 'bg-gray-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    settings.autoSwitchNetwork ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Wallet Settings */}
        <div className="bg-midnight-900 rounded-xl border border-white/5 p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <Wallet className="h-5 w-5 text-brand-400" />
            <h2 className="text-lg font-semibold text-white">Wallet Settings</h2>
          </div>
          
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
              <div>
                <div className="font-medium text-white">Show Balance</div>
                <div className="text-xs text-gray-400">Display your wallet balance in the interface</div>
              </div>
              <button
                onClick={() => setSettings(prev => ({ ...prev, showBalance: !prev.showBalance }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  settings.showBalance ? 'bg-brand-500' : 'bg-gray-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    settings.showBalance ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
              <div>
                <div className="font-medium text-white">Transaction History</div>
                <div className="text-xs text-gray-400">Show your recent transactions</div>
              </div>
              <button
                onClick={() => setSettings(prev => ({ ...prev, showTransactionHistory: !prev.showTransactionHistory }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  settings.showTransactionHistory ? 'bg-brand-500' : 'bg-gray-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    settings.showTransactionHistory ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
              <div>
                <div className="font-medium text-white">Confirm Transactions</div>
                <div className="text-xs text-gray-400">Require confirmation for all transactions</div>
              </div>
              <button
                onClick={() => setSettings(prev => ({ ...prev, confirmTransactions: !prev.confirmTransactions }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  settings.confirmTransactions ? 'bg-brand-500' : 'bg-gray-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    settings.confirmTransactions ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Notification Settings */}
        <div className="bg-midnight-900 rounded-xl border border-white/5 p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <Bell className="h-5 w-5 text-brand-400" />
            <h2 className="text-lg font-semibold text-white">Notifications</h2>
          </div>
          
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
              <div>
                <div className="font-medium text-white">Price Alerts</div>
                <div className="text-xs text-gray-400">Get notified when prices change</div>
              </div>
              <button
                onClick={() => setSettings(prev => ({ ...prev, priceAlerts: !prev.priceAlerts }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  settings.priceAlerts ? 'bg-brand-500' : 'bg-gray-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    settings.priceAlerts ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
              <div>
                <div className="font-medium text-white">Offer Updates</div>
                <div className="text-xs text-gray-400">Notifications for new offers and responses</div>
              </div>
              <button
                onClick={() => setSettings(prev => ({ ...prev, offerUpdates: !prev.offerUpdates }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  settings.offerUpdates ? 'bg-brand-500' : 'bg-gray-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    settings.offerUpdates ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
              <div>
                <div className="font-medium text-white">Auction Endings</div>
                <div className="text-xs text-gray-400">Alert when auctions are about to end</div>
              </div>
              <button
                onClick={() => setSettings(prev => ({ ...prev, auctionEndings: !prev.auctionEndings }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  settings.auctionEndings ? 'bg-brand-500' : 'bg-gray-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    settings.auctionEndings ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Display Settings */}
        <div className="bg-midnight-900 rounded-xl border border-white/5 p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <Eye className="h-5 w-5 text-brand-400" />
            <h2 className="text-lg font-semibold text-white">Display Preferences</h2>
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Language</label>
              <select
                value={settings.language}
                onChange={(e) => setSettings(prev => ({ ...prev, language: e.target.value }))}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                {languages.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Display Currency</label>
              <select
                value={settings.currency}
                onChange={(e) => setSettings(prev => ({ ...prev, currency: e.target.value }))}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                {currencies.map((curr) => (
                  <option key={curr.code} value={curr.code}>
                    {curr.code} - {curr.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Privacy Settings */}
        <div className="bg-midnight-900 rounded-xl border border-white/5 p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <Shield className="h-5 w-5 text-brand-400" />
            <h2 className="text-lg font-semibold text-white">Privacy</h2>
          </div>
          
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
              <div>
                <div className="font-medium text-white">Public Profile</div>
                <div className="text-xs text-gray-400">Make your profile visible to other users</div>
              </div>
              <button
                onClick={() => setSettings(prev => ({ ...prev, showProfilePublicly: !prev.showProfilePublicly }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  settings.showProfilePublicly ? 'bg-brand-500' : 'bg-gray-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    settings.showProfilePublicly ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
              <div>
                <div className="font-medium text-white">Share Activity Data</div>
                <div className="text-xs text-gray-400">Help improve the app by sharing usage data</div>
              </div>
              <button
                onClick={() => setSettings(prev => ({ ...prev, shareActivityData: !prev.shareActivityData }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  settings.shareActivityData ? 'bg-brand-500' : 'bg-gray-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    settings.shareActivityData ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Wallet Info */}
        <div className="bg-midnight-900 rounded-xl border border-white/5 p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <Info className="h-5 w-5 text-brand-400" />
            <h2 className="text-lg font-semibold text-white">Wallet Information</h2>
          </div>
          
          <div className="space-y-3">
            <div className="flex justify-between items-center p-3 bg-white/5 rounded-lg">
              <span className="text-sm text-gray-400">Wallet Address</span>
              <span className="text-sm font-mono text-white">
                {publicKey?.slice(0, 8)}…{publicKey?.slice(-8)}
              </span>
            </div>
            <div className="flex justify-between items-center p-3 bg-white/5 rounded-lg">
              <span className="text-sm text-gray-400">Connection Status</span>
              <span className="text-sm font-medium text-mint-400">Connected</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-white/5 rounded-lg">
              <span className="text-sm text-gray-400">Network</span>
              <span className="text-sm font-medium text-white capitalize">{network}</span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center justify-center gap-2 flex-1 rounded-xl bg-brand-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-500/25 hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {saving ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : saved ? (
              <>
                <Check className="h-4 w-4" />
                Saved!
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                Save Settings
              </>
            )}
          </button>
          
          <button
            onClick={disconnect}
            className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl border border-terracotta-500/30 bg-terracotta-500/10 text-sm font-semibold text-terracotta-400 hover:bg-terracotta-500/20 transition-all"
          >
            <X className="h-4 w-4" />
            Disconnect Wallet
          </button>
        </div>
      </div>
    </div>
  );
}
