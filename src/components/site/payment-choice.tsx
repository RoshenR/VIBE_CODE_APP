import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

export type PaymentMethod = 'card' | 'transfer';

/**
 * Choix du moyen de paiement : une vraie case radio (clavier, lecteur d'écran),
 * habillée en carte. L'état sélectionné ne repose pas que sur la couleur : le
 * cercle est plein et le libellé annonce « (sélectionné) ».
 */
export function PaymentChoice({
  value,
  current,
  onSelect,
  icon: Icon,
  title,
  detail,
}: {
  value: PaymentMethod;
  current: PaymentMethod;
  onSelect: (value: PaymentMethod) => void;
  icon: LucideIcon;
  title: string;
  detail: string;
}) {
  const selected = current === value;
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-control border p-3.5 transition-colors duration-150 has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink',
        selected ? 'border-ink bg-paper shadow-[0_0_0_1px_var(--color-ink)]' : 'border-rule-strong hover:border-ink',
      )}
    >
      <input
        type="radio"
        name="paymentMethod"
        value={value}
        checked={selected}
        onChange={() => onSelect(value)}
        className="sr-only"
      />
      <span
        className={cn(
          'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2',
          selected ? 'border-ink' : 'border-rule-strong',
        )}
        aria-hidden
      >
        {selected && <span className="bg-ink size-2.5 rounded-full" />}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-[0.9375rem] font-semibold">
          <Icon className="size-4" aria-hidden />
          {title}
          {selected && <span className="sr-only"> (sélectionné)</span>}
        </span>
        <span className="text-ink-soft mt-0.5 block text-sm">{detail}</span>
      </span>
    </label>
  );
}
