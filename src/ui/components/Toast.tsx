import { useEffect, useState } from 'react';

export interface ToastMsg { id: number; text: string; tone?: 'info' | 'error' }

export function useToast() {
  const [toast, setToast] = useState<ToastMsg | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.tone === 'error' ? 3500 : 2200);
    return () => clearTimeout(t);
  }, [toast]);
  const show = (text: string, tone: ToastMsg['tone'] = 'info') => setToast({ id: Date.now(), text, tone });
  return { toast, show };
}

export function Toast({ toast }: { toast: ToastMsg | null }) {
  return (
    <div className="toast-slot" aria-live="polite">
      {toast && <div key={toast.id} className={`toast ${toast.tone ?? 'info'}`}>{toast.text}</div>}
    </div>
  );
}
