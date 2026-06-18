import { Navigate, useNavigate } from 'react-router-dom';
import { useAuthSession } from './context/useAuthSession';
import { AuthCard } from './AuthCard';

export function LoginPage() {
  const navigate = useNavigate();
  const { user } = useAuthSession();

  // Already signed in (e.g. landed on /login with a live session, or the auth
  // listener flipped `user` truthy mid sign-in). Redirect declaratively —
  // calling navigate() during render races the post-sign-in redirect below and
  // can bounce desktop users to the home page instead of their notepad.
  if (user) {
    return <Navigate to="/notepad/notes" replace />;
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'var(--app-bg)' }}
    >
      <AuthCard onAuthenticated={() => navigate('/notepad/notes', { replace: true })} />
    </div>
  );
}
