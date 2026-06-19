import { NextResponse } from 'next/server';
import { auth } from '@/auth';

// Placeholder — clip endpoints land in Phase 4.
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ clips: [] });
}
