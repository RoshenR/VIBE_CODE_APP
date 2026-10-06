import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'solid';
export type ButtonSize = 'sm' | 'md' | 'lg';
/** Surface sur laquelle le bouton est posé : change les contrastes, pas la forme. */
export type ButtonTone = 'ivory' | 'night';

interface Options {
  variant?: ButtonVariant;
  size?: ButtonSize;
  tone?: ButtonTone;
  block?: boolean;
  className?: string;
}

/**
 * Classes d'un bouton — partagées par <Button>, <ButtonLink> et par les cas où
 * un lien doit simplement avoir l'allure d'un bouton.
 *
 * Choix de forme : un rectangle aux angles à peine adoucis, et une arête
 * « pressée » sous le bouton principal. Elle sert deux fois : c'est la
 * signature tactile du billet qu'on tamponne, et c'est ce qui délimite le
 * bouton cuivre sur fond ivoire, où son seul remplissage ne suffirait pas à
 * contraster (1,9:1).
 */
export function buttonClasses({
  variant = 'primary',
  size = 'md',
  tone = 'ivory',
  block = false,
  className,
}: Options = {}): string {
  const sizes: Record<ButtonSize, string> = {
    // 40 px au pointeur fin, 44 px dès qu'on touche l'écran.
    sm: 'h-10 px-4 text-sm pointer-coarse:h-11',
    md: 'h-12 px-5 text-[0.95rem]',
    lg: 'h-14 px-7 text-base',
  };

  const variants: Record<ButtonVariant, Record<ButtonTone, string>> = {
    primary: {
      ivory:
        'border border-transparent bg-copper text-night shadow-[0_3px_0_0_#8a4b22] hover:bg-copper-hover active:translate-y-[2px] active:bg-copper-press active:shadow-[0_1px_0_0_#8a4b22]',
      night:
        'border border-transparent bg-copper text-night shadow-[0_3px_0_0_#6f3a17] hover:bg-copper-hover active:translate-y-[2px] active:bg-copper-press active:shadow-[0_1px_0_0_#6f3a17]',
    },
    secondary: {
      ivory: 'border border-ink bg-transparent text-ink hover:bg-ink hover:text-canvas',
      night:
        'border border-on-night-soft bg-transparent text-on-night hover:bg-on-night hover:text-night',
    },
    ghost: {
      ivory: 'border border-transparent text-ink hover:bg-sunken',
      night: 'border border-transparent text-on-night hover:bg-night-high',
    },
    danger: {
      ivory:
        'border border-transparent bg-danger-ink text-white hover:bg-[#7c2020] active:bg-[#681a1a]',
      night:
        'border border-transparent bg-danger-night text-night hover:bg-[#ffb4aa] active:bg-[#ff9b8f]',
    },
    solid: {
      ivory: 'border border-transparent bg-night text-on-night hover:bg-night-high',
      night: 'border border-transparent bg-on-night text-night hover:bg-white',
    },
  };

  return cn(
    'group/btn relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-control font-semibold leading-none',
    'transition-[background-color,color,border-color,transform,box-shadow] duration-200 ease-out-soft',
    'disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none disabled:active:translate-y-0',
    'aria-disabled:cursor-not-allowed aria-disabled:opacity-45',
    sizes[size],
    variants[variant][tone],
    block && 'w-full',
    className,
  );
}

type ButtonProps = Options &
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    /** Affiche un indicateur et bloque l'action, sans changer la largeur du bouton. */
    loading?: boolean;
  };

export function Button({
  variant,
  size,
  tone,
  block,
  className,
  loading = false,
  disabled,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses({ variant, size, tone, block, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

type ButtonLinkProps = Options &
  Omit<React.ComponentProps<typeof Link>, 'className'> & {
    className?: string;
  };

export function ButtonLink({
  variant,
  size,
  tone,
  block,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link className={buttonClasses({ variant, size, tone, block, className })} {...rest}>
      {children}
    </Link>
  );
}
