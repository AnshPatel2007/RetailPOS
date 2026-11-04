import { Link } from 'react-router-dom';
import { Lock, SearchX } from 'lucide-react';
import { buttonClassName } from '@/components/ui/Button';
import { QuickFindHint } from './QuickFindHint';

/** Shown inside the normal menu so people can carry on somewhere they do have access. */
export function AccessDenied() {
  return <StatusPage icon={<Lock className="h-6 w-6" />} title="Access Denied"
    message="Your role can't open this page. Ask the store owner if you need it." />;
}

export function NotFound() {
  return <StatusPage icon={<SearchX className="h-6 w-6" />} title="Page not found"
    message="This link may be old, or the page has moved." />;
}

function StatusPage({ icon, title, message }: { icon: React.ReactNode; title: string; message: string }) {
  return <div className="flex min-h-[60vh] items-center justify-center p-6">
    <div className="max-w-sm text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">{icon}</div>
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      <div className="mt-6 flex flex-col items-center gap-3">
        <Link to="/" className={buttonClassName({})}>Go to Dashboard</Link>
        <QuickFindHint />
      </div>
    </div>
  </div>;
}
