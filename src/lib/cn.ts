import type { CSSProperties } from 'react';

/**
 * Assemble des noms de classes en ignorant les valeurs vides.
 *
 * Une fonction de quelques lignes plutôt qu'une dépendance : on n'a besoin ni de
 * fusion de classes Tailwind ni de variantes conditionnelles complexes.
 */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * Décalage d'apparition d'un élément (classe `.reveal`) : le n-ième élément d'un
 * groupe démarre n × 70 ms après le premier. Un seul enchaînement orchestré
 * donne plus d'effet que dix micro-animations dispersées.
 */
export function stagger(index: number): CSSProperties {
  return { '--i': index } as CSSProperties;
}
