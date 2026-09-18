import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { SignInForm } from './form';

export const metadata = { title: 'Connexion' };

export default async function SignInPage() {
  if (await getCurrentUser()) redirect('/admin');

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="text-ink-900 text-xl font-semibold tracking-tight">Connexion</h1>
      <p className="text-ink-500 mt-1 text-sm">
        Accès réservé aux organisateurs.
      </p>
      <SignInForm />
    </div>
  );
}
