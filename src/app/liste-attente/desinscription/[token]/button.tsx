'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { InlineAlert } from '@/components/ui/states';
import { unsubscribeAction } from './actions';

export function UnsubscribeButton({ token }: { token: string }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<'idle' | 'done' | 'error'>('idle');

  if (state === 'done') {
    return (
      <InlineAlert tone="success" title="C'est fait." className="mt-6">
        Vous ne recevrez plus d&apos;offre pour cet événement.
      </InlineAlert>
    );
  }

  return (
    <div className="mt-6">
      <Button
        size="lg"
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await unsubscribeAction(token);
            setState(result.ok ? 'done' : 'error');
          })
        }
      >
        {pending ? 'Désinscription…' : 'Confirmer ma désinscription'}
      </Button>

      {state === 'error' && (
        <InlineAlert tone="danger" className="mt-4">
          Ce lien n&apos;est plus valable : vous êtes peut-être déjà désinscrit·e.
        </InlineAlert>
      )}
    </div>
  );
}
