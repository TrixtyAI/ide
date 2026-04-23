import React, { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useL10n } from '@/hooks/useL10n';
import { safeInvoke } from '@/api/tauri';
import { X, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
  const { cloudEndpoint, updateAISettings } = useApp();
  const { t } = useL10n();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setSuccess(null);

    const endpoint = mode === 'login' ? '/auth/login' : '/auth/register';
    const baseUrl = cloudEndpoint;
    const fullUrl = `${baseUrl.replace(/\/+$/, '')}${endpoint}`;

    try {
      const response = await safeInvoke('ollama_proxy', {
        method: 'POST',
        url: fullUrl,
        body: { type: 'auth', email, password }
      });

      if (response.status >= 200 && response.status < 300) {
        if (mode === 'register') {
          // If register is successful, automatically try to log in
          const loginResponse = await safeInvoke('ollama_proxy', {
            method: 'POST',
            url: `${baseUrl.replace(/\/+$/, '')}/auth/login`,
            body: { type: 'auth', email, password }
          });

          if (loginResponse.status >= 200 && loginResponse.status < 300) {
            const data = JSON.parse(loginResponse.body);
            if (data.token) {
              updateAISettings({ cloudToken: data.token });
              setSuccess(t('auth.success'));
              setTimeout(() => {
                onClose();
              }, 1000);
            }
          } else {
            setError("Registration successful, but auto-login failed. Please sign in.");
            setMode('login');
          }
        } else {
          // Login flow
          const data = JSON.parse(response.body);
          if (data.token) {
            updateAISettings({ cloudToken: data.token });
            setSuccess(t('auth.success'));
            setTimeout(() => {
              onClose();
            }, 1000);
          } else {
            setError("Invalid response format. Missing token.");
          }
        }
      } else {
        try {
          const errData = JSON.parse(response.body);
          setError(errData.error || errData.message || t('auth.error'));
        } catch {
          setError(`HTTP Error: ${response.status}`);
        }
      }
    } catch (err: unknown) {
      setError((err as Error).message || t('auth.error'));
    } finally {
      setIsLoading(false);
    }
  };

  const toggleMode = () => {
    setMode(mode === 'login' ? 'register' : 'login');
    setError(null);
    setSuccess(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#111] border border-white/10 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/5 bg-[#161616]">
          <h2 className="text-sm font-bold text-white">
            {mode === 'login' ? t('auth.login_title') : t('auth.register_title')}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-[#888] hover:text-white hover:bg-white/10 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-2">
                <AlertCircle size={14} className="text-red-500 mt-0.5 shrink-0" />
                <p className="text-[12px] text-red-500/90 leading-tight">{error}</p>
              </div>
            )}

            {success && (
              <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg flex items-start gap-2">
                <CheckCircle2 size={14} className="text-green-500 mt-0.5 shrink-0" />
                <p className="text-[12px] text-green-500/90 leading-tight">{success}</p>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-[#888] uppercase tracking-wider">
                {t('auth.email_label')}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full bg-[#1a1a1a] border border-[#333] rounded-md px-3 py-2 text-[13px] text-white focus:outline-none focus:border-purple-500/50 transition-colors"
                placeholder="user@example.com"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-[#888] uppercase tracking-wider">
                {t('auth.password_label')}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="w-full bg-[#1a1a1a] border border-[#333] rounded-md px-3 py-2 text-[13px] text-white focus:outline-none focus:border-purple-500/50 transition-colors"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading || !email || !password}
              className="w-full py-2.5 bg-purple-600 hover:bg-purple-500 text-white text-[13px] font-bold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-2 shadow-lg shadow-purple-900/20"
            >
              {isLoading && <Loader2 size={14} className="animate-spin" />}
              {mode === 'login' ? t('auth.submit_login') : t('auth.submit_register')}
            </button>
          </form>

          <div className="mt-6 text-center border-t border-white/5 pt-4">
            <button
              type="button"
              onClick={toggleMode}
              className="text-[12px] text-[#888] hover:text-purple-400 transition-colors underline-offset-4 hover:underline"
            >
              {mode === 'login' ? t('auth.switch_to_register') : t('auth.switch_to_login')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
