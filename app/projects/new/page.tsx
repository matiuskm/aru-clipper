import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { NewProjectForm } from './new-project-form';

export default async function NewProjectPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  return <NewProjectForm />;
}
