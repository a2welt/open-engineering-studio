import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { MockOatClient } from '../api/oat/mock';
import { SampleXrayClient } from '../api/xray/client';
import { App } from '../App';
import { ServicesProvider } from '../services';

function renderStudio() {
  const services = { xray: [new SampleXrayClient()], oat: new MockOatClient(0) };
  return render(
    <ServicesProvider services={services}>
      <App />
    </ServicesProvider>,
  );
}

describe('Studio shell', () => {
  it('opens on the lifecycle with every stage, changes in flight and what needs you', async () => {
    window.location.hash = '';
    renderStudio();

    expect(await screen.findByRole('heading', { name: /agents write the code/i })).toBeVisible();
    const stages = within(screen.getByRole('list', { name: 'Lifecycle of a change' })).getAllByRole('listitem');
    expect(stages.map((s) => s.querySelector('.stage-title')?.textContent)).toEqual([
      'Intent',
      'Impact',
      'Agent work',
      'Verify',
      'Review',
      'Remember',
    ]);
    const changes = screen.getByRole('region', { name: 'Changes in flight' });
    expect(within(changes).getByText('High risk')).toBeVisible();
    expect(within(changes).getByText('Ready to merge')).toBeVisible();
    expect(within(changes).getByText('Needs 1 signed approval')).toBeVisible();
    const needs = screen.getByRole('complementary', { name: 'Needs you' });
    expect(await within(needs).findByText('Approve')).toBeVisible();
    expect(within(needs).getByText(/no agent receipts reference this change/i)).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'Connected tools' })).toHaveTextContent('Repo X-Ray');
  });

  it('Understand maps the layers and answers what breaks', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/understand';
    renderStudio();

    expect(await screen.findByRole('heading', { name: /understand open-model-fabric/i })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Application core' })).toBeVisible();
    // The opening question is the routing service; its direct importers are listed.
    const direct = await screen.findByRole('region', { name: 'Depth 1' });
    expect(within(direct).getByText('python/omf/bootstrap/container.py')).toBeVisible();
    expect(within(direct).getByText('python/omf/core/services/inference.py')).toBeVisible();

    await user.type(screen.getByLabelText(/what breaks if i change…/i), 'core/domain/errors.py');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByText(/what breaks if i change python\/omf\/core\/domain\/errors\.py/i)).toBeVisible();

    await user.clear(screen.getByLabelText(/what breaks if i change…/i));
    await user.type(screen.getByLabelText(/what breaks if i change…/i), 'missing.py');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('does not match');
  });

  it('Trust approves and signs, then shows the verified receipt', async () => {
    const user = userEvent.setup();
    renderStudio();

    const nav = screen.getByRole('navigation', { name: 'Studio' });
    await user.click(within(nav).getByRole('link', { name: /trust/i }));
    expect(within(nav).getByRole('link', { name: /trust/i })).toHaveAttribute('aria-current', 'page');

    const card = await screen.findByRole('region', { name: /wants to edit routing\.py/i });
    await waitFor(() => expect(within(card).getByText('28 affected files')).toBeVisible());
    await user.click(within(card).getByRole('button', { name: 'Approve and sign' }));

    expect(await screen.findByRole('heading', { name: 'Nothing waiting for you' })).toBeVisible();
    const receipt = screen.getByRole('complementary', { name: 'Receipt' });
    await waitFor(() => expect(within(receipt).getByText('11 independent checks, all passed')).toBeVisible());
    expect(within(receipt).getByText('Verified')).toBeVisible();
    expect(within(nav).queryByLabelText(/waiting/)).not.toBeInTheDocument();
  });

  it('Trust rejects with a reason', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/trust';
    renderStudio();

    const card = await screen.findByRole('region', { name: /wants to edit/i });
    await user.click(within(card).getByRole('button', { name: 'Reject' }));
    await user.type(within(card).getByLabelText(/why are you rejecting/i), 'Breaks ADR-0003');
    await user.click(within(card).getByRole('button', { name: 'Reject request' }));

    const activity = await screen.findByRole('region', { name: "Today's agent activity" });
    await waitFor(() => expect(within(activity).getByText('Rejected')).toBeVisible());
  });

  it('Remember shows recalled decisions and the savings placeholder', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/remember';
    renderStudio();

    const first = await screen.findByRole('button', { name: /ADR-0003 Capability evidence/i });
    expect(first).toHaveAttribute('aria-expanded', 'true');
    const other = screen.getByRole('button', { name: /ADR-0004/i });
    await user.click(other);
    expect(other).toHaveAttribute('aria-expanded', 'true');
    expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('heading', { name: 'Token savings' })).toBeVisible();
    expect(screen.getByText('Waiting for first measurements')).toBeVisible();
  });

  it('toggles and remembers the theme', async () => {
    const user = userEvent.setup();
    renderStudio();
    await user.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('studio-theme')).toBe('dark');
    await user.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
