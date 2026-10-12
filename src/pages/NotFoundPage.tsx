import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="page empty-state">
      <h1>Page not found</h1>
      <p className="muted">That address does not match any lesson or tool.</p>
      <Link to="/" className="btn btn--primary">
        Back to home
      </Link>
    </div>
  );
}
