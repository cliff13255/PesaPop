import { Link } from 'react-router-dom';

export function LandingPage() {
  return (
    <>
      <section className="hero">
        <div className="container hero-inner">
          <h1>Pay anyone in Kenya by just saying it.</h1>
          <p className="hero-sub">
            Type “send 500 to John” and PesaPop sets up an M-Pesa payment. You check the details and confirm, then
            approve the prompt on your phone. Nothing moves until you do.
          </p>
          <div className="hero-actions">
            <Link to="/dashboard" className="btn btn-accent btn-lg">
              Try the demo
            </Link>
            <Link to="/merchant" className="btn btn-outline-light btn-lg">
              See the merchant view
            </Link>
          </div>
        </div>
      </section>

      <section className="container section">
        <div className="grid-3">
          <div className="benefit">
            <span className="benefit-icon" aria-hidden="true">💬</span>
            <h2>Talk to pay</h2>
            <p>Ask in plain words. If something is missing, like the phone number, the assistant asks for it instead of guessing.</p>
          </div>
          <div className="benefit">
            <span className="benefit-icon" aria-hidden="true">✅</span>
            <h2>Confirm before you pay</h2>
            <p>Every payment shows the recipient, amount, fee and phone number first. Only your Confirm tap sends it.</p>
          </div>
          <div className="benefit">
            <span className="benefit-icon" aria-hidden="true">📍</span>
            <h2>Clear status tracking</h2>
            <p>Watch each payment go from pending to successful or failed, with the M-Pesa receipt saved in your history.</p>
          </div>
        </div>
      </section>

      <section className="section section-alt">
        <div className="container">
          <h2 className="section-title">How it works</h2>
          <ol className="steps">
            <li>
              <span className="step-num">1</span>
              <div>
                <h3>Say what you want to pay</h3>
                <p>Use the assistant or the payment form.</p>
              </div>
            </li>
            <li>
              <span className="step-num">2</span>
              <div>
                <h3>Review and confirm</h3>
                <p>Check the summary, then tap Confirm.</p>
              </div>
            </li>
            <li>
              <span className="step-num">3</span>
              <div>
                <h3>Approve on your phone</h3>
                <p>Enter your PIN in the M-Pesa prompt and watch the status update.</p>
              </div>
            </li>
          </ol>
        </div>
      </section>

      <section className="container section trust">
        <h2 className="section-title">Your money, your decision</h2>
        <ul className="trust-list">
          <li>The AI assistant can never send money. Only your Confirm tap starts a payment.</li>
          <li>PesaPop will never ask for your M-Pesa PIN. You only enter it on your own phone.</li>
          <li>We only show a payment as successful when the payment provider confirms it.</li>
        </ul>
      </section>

      <footer className="footer">
        <div className="container footer-inner">
          <span>© {new Date().getFullYear()} PesaPop</span>
          <span>M-Pesa payments powered by PayHero STK Push</span>
        </div>
      </footer>
    </>
  );
}
