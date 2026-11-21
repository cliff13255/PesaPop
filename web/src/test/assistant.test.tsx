import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AssistantPage } from '../pages/AssistantPage';
import { DemoProvider } from '../demo/DemoContext';
import { config, mockFetch, summary } from './fetchMock';

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/assistant']}>
      <DemoProvider>
      <Routes>
        <Route path="/assistant" element={<AssistantPage />} />
        <Route path="/payments/:id" element={<p>status page</p>} />
      </Routes>
      </DemoProvider>
    </MemoryRouter>,
  );

describe('AssistantPage', () => {
  it('shows Still needed, then a summary; only the popup Confirm moves money', async () => {
    let turn = 0;
    const calls = mockFetch((path, init) => {
      if (path === '/config') return { body: config() };
      if (path === '/assistant/messages') {
        turn += 1;
        return turn === 1
          ? { body: { conversation_id: 'cnv_1', reply: 'What is the number?', missing_fields: ['phone'], payment_summary: null, confirmation_id: null, assistant_mode: 'claude' } }
          : { body: { conversation_id: 'cnv_1', reply: 'Here it is. Review and confirm.', missing_fields: [], payment_summary: summary, confirmation_id: 'cnf_9', assistant_mode: 'claude' } };
      }
      if (path === '/payments/cnf_9/confirm' && init.method === 'POST') return { body: { id: 'pay_9', status: 'pending', confirmation_id: 'cnf_9' } };
      return undefined;
    });
    renderPage();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Message'), 'send 500 to John');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Still needed')).toBeInTheDocument();
    expect(screen.getByText('M-Pesa phone number')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Message'), '0712345678');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByRole('button', { name: /review and confirm/i });
    expect(calls.filter((c) => c.path === '/assistant/messages')[1]?.body).toEqual({ message: '0712345678', conversation_id: 'cnv_1' });
    expect(calls.some((c) => c.path.endsWith('/confirm'))).toBe(false);

    await user.click(screen.getByRole('button', { name: /review and confirm/i }));
    await user.click(screen.getByRole('button', { name: /confirm kes 500/i }));
    expect(await screen.findByText('status page')).toBeInTheDocument();
    expect(calls.filter((c) => c.path.endsWith('/confirm'))).toHaveLength(1);
  });

  it('offers Retry after an error', async () => {
    let fail = true;
    mockFetch((path) =>
      path === '/config'
        ? { body: config() }
        : fail
        ? { status: 502, body: { error: { code: 'assistant_unavailable', message: 'down' } } }
        : { body: { conversation_id: 'cnv_2', reply: 'Back online!', missing_fields: [], payment_summary: null, confirmation_id: null, assistant_mode: 'claude' } },
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Send KES 500 to John' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('down');
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Back online!')).toBeInTheDocument();
  });
});
