import { useGetMe } from "@workspace/api-client-react";
import { Link } from "wouter";

export default function NotFound() {
  const { data: user } = useGetMe();

  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center text-center px-4">
      <div className="text-primary font-mono font-bold text-8xl mb-4">404</div>
      <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white mb-2">Page not found</h1>
      <p className="text-slate-500 max-w-md mb-8">
        Sorry, we couldn't find the page you're looking for. It might have been moved or you might not have access to it.
      </p>
      <Link href={user ? "/dashboard" : "/"} className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-8 py-2">
        {user ? "Back to Dashboard" : "Back to Login"}
      </Link>
    </div>
  );
}
