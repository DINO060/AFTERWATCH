'use client';
import { useEffect, useState } from 'react';
import { Download, Check } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useI18n } from './i18n-provider';
type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};
export default function InstallApp() {
  const { t, lang } = useI18n();
  const colon = lang === 'fr' ? ' :' : ':';
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  const [help, setHelp] = useState(false);
  useEffect(() => {
    const check = () =>
      setInstalled(
        window.matchMedia('(display-mode: standalone)').matches ||
          !!(navigator as Navigator & { standalone?: boolean }).standalone,
      );
    const capture = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    const done = () => {
      setInstalled(true);
      setPrompt(null);
    };
    check();
    window.addEventListener('beforeinstallprompt', capture);
    window.addEventListener('appinstalled', done);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    return () => {
      window.removeEventListener('beforeinstallprompt', capture);
      window.removeEventListener('appinstalled', done);
    };
  }, []);
  const install = async () => {
    if (!prompt) {
      setHelp(true);
      return;
    }
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'accepted') setInstalled(true);
      setPrompt(null);
    } catch {
      setHelp(true);
    }
  };
  return (
    <>
      <button className="ghost-btn small-btn install-button" onClick={install} disabled={installed}>
        {installed ? <Check size={16} /> : <Download size={16} />}
        <span>{installed ? t.install.installed : t.install.install}</span>
      </button>
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.install.title}</DialogTitle>
            <DialogDescription>{t.install.description}</DialogDescription>
          </DialogHeader>
          <div className="install-help">
            <p>
              <strong>iPhone / iPad{colon}</strong> {t.install.ios}
            </p>
            <p>
              <strong>Android{colon}</strong> {t.install.android}
            </p>
            <p>
              <strong>Windows / Mac{colon}</strong> {t.install.desktop}
            </p>
            <p className="form-hint">{t.install.hint}</p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
