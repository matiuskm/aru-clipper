// Maps a project status to a coloured pill. Pure presentational helper.
const STYLES: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-white/70',
  uploading: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
  uploaded: 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300',
  downloading: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
  analyzing: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  completed: 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',
};

export function StatusBadge({ status }: { status: string }) {
  const cls = STYLES[status] ?? STYLES.pending;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${cls}`}>
      {status}
    </span>
  );
}
