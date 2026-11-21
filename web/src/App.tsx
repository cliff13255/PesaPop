import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { Card, ErrorBanner, ModeBanner, Spinner } from './components/ui';
import { useDemo, type Role } from './demo/DemoContext';
import { AssistantPage } from './pages/AssistantPage';
import { CustomerDashboard } from './pages/CustomerDashboard';
import { HistoryPage } from './pages/HistoryPage';
import { LandingPage } from './pages/LandingPage';
import { MerchantDashboard } from './pages/MerchantDashboard';
import { PayPage } from './pages/PayPage';
import { PaymentStatusPage } from './pages/PaymentStatusPage';

/** Loads demo settings and, if the server asks for one, the demo passcode. */
function DemoGate({ children, role }: { children: ReactNode; role?: Role }) {
  const demo = useDemo();
  const [code, setCode] = useState('');
  const { setRole } = demo;
  useEffect(() => {
    if (role) setRole(role);
  }, [role, setRole]);

  if (demo.configError) {
    return (
      <div className="container narrow page">
        <ErrorBanner message={demo.configError} onRetry={demo.reloadConfig} />
      </div>
    );
  }
  if (!demo.config) return <Spinner label="Loading PesaPop" block />;
  if (demo.needsCode) {
    const submit = (e: FormEvent) => {
      e.preventDefault();
      if (code.trim()) demo.submitCode(code);
    };
    return (
      <div className="container narrow page">
        <Card>
          <h1>Demo passcode</h1>
          <p className="muted">This demo is private. Enter the passcode you were given.</p>
          <form className="form" onSubmit={submit}>
            <label className="field">
              <span>Passcode</span>
              <input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
            </label>
            <button type="submit" className="btn btn-primary btn-block">
              Continue
            </button>
          </form>
        </Card>
      </div>
    );
  }
  return <>{children}</>;
}

export function App() {
  const location = useLocation();
  const inApp = location.pathname !== '/';
  return (
    <>
      <Navbar inApp={inApp} />
      {inApp && <ModeBanner />}
      <main>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/dashboard" element={<DemoGate role="customer"><CustomerDashboard /></DemoGate>} />
          <Route path="/pay" element={<DemoGate role="customer"><PayPage /></DemoGate>} />
          <Route path="/assistant" element={<DemoGate role="customer"><AssistantPage /></DemoGate>} />
          <Route path="/merchant" element={<DemoGate role="merchant"><MerchantDashboard /></DemoGate>} />
          <Route path="/payments/:id" element={<DemoGate><PaymentStatusPage /></DemoGate>} />
          <Route path="/history" element={<DemoGate><HistoryPage /></DemoGate>} />
          <Route path="/auth" element={<Navigate to="/dashboard" replace />} />
          <Route
            path="*"
            element={
              <div className="container narrow page">
                <h1>Page not found</h1>
                <Link to="/">Go home</Link>
              </div>
            }
          />
        </Routes>
      </main>
    </>
  );
}
