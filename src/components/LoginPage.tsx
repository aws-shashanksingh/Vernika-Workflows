import React, { useState } from 'react';
import { ArrowRight, CheckCircle2, AlertCircle, Mail, Linkedin, Instagram, ExternalLink } from 'lucide-react';
import { setWorkspaceStorageScope } from '../services/workspaceStorage';

interface LoginPageProps {
  onLoginSuccess: () => void;
  isDarkMode: boolean;
  onBackToPublic?: () => void;
  otpOnly?: boolean;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess, isDarkMode, onBackToPublic, otpOnly = false }) => {
  const [step, setStep] = useState<1 | 2>(otpOnly ? 2 : 1);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [challengeId, setChallengeId] = useState('');

  const handleStep1Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const response = await fetch('/api/access/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username: username.trim(), password, tool: 'blogger', portal: 'blogger' }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Login failed.');
      setChallengeId(result.challengeId);
      setStep(2);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Login failed.');
    }
  };

  const handleStep2Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const response = await fetch(otpOnly ? '/api/access/unlock' : '/api/access/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(otpOnly ? { otp: otp.trim() } : { challengeId, otp: otp.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'OTP verification failed.');
      if (result.role === 'admin' || result.redirectTo) {
        window.location.replace(result.redirectTo || '/admin/');
        return;
      }
      sessionStorage.setItem('vernika_tab_tool', 'blogger');
      if (!otpOnly) setWorkspaceStorageScope(result.workspaceId || 'guest');
      onLoginSuccess();
    } catch (verificationError) {
      setError(verificationError instanceof Error ? verificationError.message : 'OTP verification failed.');
    }
  };

  return (
    <div className={`min-h-screen flex flex-col justify-between p-6 transition-colors font-sans ${
      isDarkMode ? 'bg-slate-950 text-slate-100' : 'bg-slate-100 text-slate-900'
    }`}>
      <div className="flex-1 flex items-center justify-center">
        <div className={`w-full max-w-sm p-8 rounded-2xl border shadow-xl transition-all ${
          isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
        }`}>
          
          {onBackToPublic && (
            <button
              onClick={onBackToPublic}
              className="mb-4 text-xs font-semibold text-sky-600 dark:text-sky-400 hover:underline flex items-center gap-1"
            >
              ← Back to Vernika
            </button>
          )}

          {/* Header */}
          <div className="text-center space-y-3 mb-6">
            <img
              src="https://vsybbtdfiozzcbcuvlpi.supabase.co/storage/v1/object/public/DATA/Logo/Automation%20workflow%20logo.png"
              alt="Vernika Workflows"
              className="w-20 h-20 mx-auto object-contain rounded-xl"
            />
            <div>
              <div className="text-xs font-bold text-sky-600 dark:text-sky-400 uppercase tracking-wider">
                Automated-Blogger
              </div>
              <h1 className="text-lg font-bold tracking-tight">Publisher Authentication</h1>
            </div>
          </div>



          {/* Error Message */}
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* STEP 1: Username & Password */}
          {step === 1 && !otpOnly && (
            <form onSubmit={handleStep1Submit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Username</label>
                <input
                  type="text"
                  autoComplete="off"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className={`w-full p-2.5 text-xs rounded-lg border outline-none font-medium transition ${
                    isDarkMode ? 'bg-slate-950 border-slate-800 text-white focus:border-sky-500' : 'bg-slate-50 border-slate-300 text-slate-900 focus:border-sky-500'
                  }`}
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`w-full p-2.5 text-xs rounded-lg border outline-none font-medium transition ${
                    isDarkMode ? 'bg-slate-950 border-slate-800 text-white focus:border-sky-500' : 'bg-slate-50 border-slate-300 text-slate-900 focus:border-sky-500'
                  }`}
                  required
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs transition shadow flex items-center justify-center gap-2"
              >
                <span>Continue</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </form>
          )}

          {/* STEP 2: 2-Step OTP Verification */}
          {step === 2 && (
            <form onSubmit={handleStep2Submit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Security OTP</label>
                <input
                  type="password"
                  autoComplete="off"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  className={`w-full p-2.5 text-center text-sm tracking-widest font-mono rounded-lg border outline-none font-bold transition ${
                    isDarkMode ? 'bg-slate-950 border-slate-800 text-white focus:border-sky-500' : 'bg-slate-50 border-slate-300 text-slate-900 focus:border-sky-500'
                  }`}
                  required
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition shadow flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Verify OTP</span>
              </button>

              {!otpOnly && <button
                type="button"
                onClick={() => { setStep(1); setError(null); }}
                className="w-full text-center text-xs text-slate-500 hover:underline pt-1"
              >
                ← Back
              </button>}
            </form>
          )}

          {/* Developer Attribution Inside Login Box */}
          <div className="pt-6 mt-6 border-t border-slate-200 dark:border-slate-800 text-center space-y-2">
            <div className="text-xs font-medium text-slate-600 dark:text-slate-400">
              Developed by Shashank Rajput
            </div>
            <div className={`mt-5 rounded-xl border p-3 text-left ${isDarkMode ? 'border-slate-800 bg-slate-950/60' : 'border-slate-200 bg-slate-50'}`}>
              <p className="text-[10px] font-black uppercase tracking-wider text-sky-500">Related tool</p>
              <p className="mt-1 text-xs font-bold">Blogger Indexer</p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">Submit published pages for search discovery and monitor their progress.</p>
              <a href="/indexer/" className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-sky-600 dark:text-sky-400">
                Open companion tool <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <div className={`mt-5 rounded-xl border p-3 text-left ${isDarkMode ? 'border-slate-800 bg-slate-950/60' : 'border-slate-200 bg-slate-50'}`}>
              <p className="text-[10px] font-black uppercase tracking-wider text-violet-500">Related tool</p>
              <p className="mt-1 text-xs font-bold">BlackHat - AUTOMATOR</p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">Automate high-volume PDF creation and keyword scaling.</p>
              <a href="/seo-pdf/" className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-violet-600 dark:text-violet-400">
                Open BlackHat tool <ExternalLink className="h-3 w-3" />
              </a>
            </div>

            <div className="flex items-center justify-center gap-3">
              <a
                href="https://mail.google.com/mail/u/0/?fs=1&to=aws.shashanksingh@gmail.com&tf=cm"
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 rounded-full hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-sky-600 transition"
                title="Email"
              >
                <Mail className="w-4 h-4" />
              </a>
              <a
                href="https://www.linkedin.com/in/shashankrajputx/"
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 rounded-full hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-blue-600 transition"
                title="LinkedIn"
              >
                <Linkedin className="w-4 h-4" />
              </a>
              <a
                href="https://www.instagram.com/shashankrajput.__/"
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 rounded-full hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-rose-600 transition"
                title="Instagram"
              >
                <Instagram className="w-4 h-4" />
              </a>
            </div>
          </div>

        </div>
      </div>

    </div>
  );
};
