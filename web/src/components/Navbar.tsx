import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useDemo, type Role } from '../demo/DemoContext';

export function Navbar({ inApp }: { inApp: boolean }) {
  const { role, setRole } = useDemo();
  const navigate = useNavigate();

  const switchTo = (r: Role) => {
    setRole(r);
    navigate(r === 'merchant' ? '/merchant' : '/dashboard');
  };

  return (
    <header className="navbar">
      <div className="container navbar-inner">
        <Link to="/" className="brand">
          <span className="brand-dot" aria-hidden="true" />
          PesaPop
        </Link>
        {inApp ? (
          <>
            <div className="role-switch" role="group" aria-label="Demo view">
              {(['customer', 'merchant'] as const).map((r) => (
                <button key={r} type="button" className={role === r ? 'active' : ''} aria-pressed={role === r} onClick={() => switchTo(r)}>
                  {r === 'customer' ? 'Customer' : 'Merchant'}
                </button>
              ))}
            </div>
            <nav className="nav-links" aria-label="Main">
              {role === 'merchant' ? (
                <NavLink to="/merchant">Dashboard</NavLink>
              ) : (
                <>
                  <NavLink to="/dashboard">Home</NavLink>
                  <NavLink to="/pay">Pay</NavLink>
                  <NavLink to="/assistant">Assistant</NavLink>
                </>
              )}
              <NavLink to="/history">History</NavLink>
            </nav>
          </>
        ) : (
          <nav className="nav-links" aria-label="Main">
            <Link to="/dashboard" className="btn btn-accent btn-sm">
              Try the demo
            </Link>
          </nav>
        )}
      </div>
    </header>
  );
}
