import { useEffect, useRef } from 'react';
import { useAuth } from '../lib/auth-context';

// Automatic logoff (HIPAA §164.312(a)(2)(iii)). Signs the user out after
// `idleTimeoutMinutes` of no activity. Driven by the app setting (admin-editable);
// 0 disables. Activity = pointer / key / scroll / touch.
export default function SessionTimeout() {
  const { settings } = useAuth();
  const minutes = settings?.idleTimeoutMinutes ?? 0;
  const timer = useRef(null);

  useEffect(() => {
    if (!minutes || minutes <= 0) return; // disabled
    const ms = minutes * 60 * 1000;

    const signOut = () => {
      if (import.meta.env.DEV) {
        // No SWA auth endpoint in dev — just return to the top.
        window.location.assign('/');
      } else {
        window.location.assign('/.auth/logout?post_logout_redirect_uri=/');
      }
    };

    const reset = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(signOut, ms);
    };

    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();

    return () => {
      events.forEach((e) => window.removeEventListener(e, reset));
      if (timer.current) clearTimeout(timer.current);
    };
  }, [minutes]);

  return null;
}
