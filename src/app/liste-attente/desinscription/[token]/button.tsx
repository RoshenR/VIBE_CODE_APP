'use client';

import { useState, useTransition } from 'react';
import { unsubscribeAction } from './actions';

export function UnsubscribeButton({ token }: { token: string }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<'idle' | 'done' | 'error'>('idle');

  if (state === 'done') {
    return (
      <p
        role="status"
        className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
      >
        C&apos;est fait. Vous ne recevrez plus d&apos;offre pour cet événement.
      </p>
    );
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await unsubscribeAction(token);
            setState(result.ok ? 'done' : 'error');
          })
        }
        className="bg-ink-900 hover:bg-ink-800 rounded-xl px-5 py-3 font-semibold text-white disabled:opacity-60"
      >
        {pending ? 'Désinscription…' : 'Confirmer ma désinscription'}
      </button>

      {state === 'error' && (
        <p role="alert" className="mt-3 text-sm text-rose-700">
          Ce lien n&apos;est plus valable. Vous êtes peut-être déjà désinscrit·e.
        </p>
      )}
    </div>
  );
}
