// @vitest-environment jsdom
/**
 * Dashboard edit mode over a Bot's sandboxed page: the host turns Edit on in the frame,
 * refuses a path the page does not declare, draws the gateway's lineage for one it does,
 * and sends a change request only from the person's own Send.
 */
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { api, type DashboardLineage } from '../../api/client'
import { renderWithProviders } from '../../test/helpers'
import CrewDashboardEditLayer from './CrewDashboardEditLayer'
import { EDIT_MESSAGE_TYPE, PICKED_MESSAGE_TYPE } from './dashboardEdit'

const MANIFEST = {
  id: 'project-report', version: 1, title: '', description: '', source: 'builtin',
  fields: {
    accepted: { type: 'number', source: { fold: 'workstreams', path: 'accepted' } },
    verdict: { type: 'string', source: { agentic: true } },
  },
}

const LINEAGE: DashboardLineage = {
  path: 'accepted', field: 'accepted', kind: 'fold', type: 'number', found: true, value: 7,
  hops: [
    { kind: 'field', field: 'accepted', type: 'number', fold: 'workstreams', path: 'accepted' },
    { kind: 'fold', fold: 'workstreams', path: 'accepted', found: true, by: 'gateway' },
    { kind: 'crew_log', fold: 'workstreams', needs: 'entry seq on fold rows' },
  ],
  edit: { kind: 'fold' },
}

function Host({ onSend }: { onSend?: (text: string) => Promise<boolean> }) {
  const ref = useRef<HTMLIFrameElement | null>(null)
  return (
    <div className="relative">
      <iframe ref={ref} title="page" data-testid="frame" />
      <CrewDashboardEditLayer
        frameRef={ref}
        frameKey="k"
        slug="atlas"
        member="Atlas"
        botName="Atlas"
        manifest={MANIFEST}
        board="project-report"
        instanceVersion={14}
        onSend={onSend}
        onDone={() => {}}
      />
    </div>
  )
}

function frameWindow(): Window {
  return (screen.getByTestId('frame') as HTMLIFrameElement).contentWindow as Window
}

/** The frame's answer for keyboard focus (`seq: -1`). The hover dwell is waited out
 *  by each case's `findBy*`, which polls. */
function pick(data: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: PICKED_MESSAGE_TYPE, seq: -1, rect: { x: 10, y: 10, w: 30, h: 20 }, block: '', blockRect: null, blockFields: [], ...data },
      source: frameWindow(),
    }))
  })
}

afterEach(() => vi.restoreAllMocks())

describe('CrewDashboardEditLayer', () => {
  it('turns Edit on in the frame it draws over', async () => {
    const posted: unknown[] = []
    renderWithProviders(<Host />)
    vi.spyOn(frameWindow(), 'postMessage').mockImplementation((m: unknown) => { posted.push(m) })
    act(() => { window.dispatchEvent(new MessageEvent('message', { data: { type: 'kirocrew-dashboard:ready' }, source: frameWindow() })) })
    expect(posted).toContainEqual({ type: EDIT_MESSAGE_TYPE, on: true })
  })

  it('refuses a path the page does not declare and asks the gateway nothing', async () => {
    const lineage = vi.spyOn(api, 'memberDashboardLineage')
    renderWithProviders(<Host />)
    pick({ path: 'secret' })
    expect(await screen.findByTestId('dashboard-edit-refused')).toHaveTextContent('secret')
    expect(lineage).not.toHaveBeenCalled()
  })

  it('draws the lineage the gateway built for a declared path', async () => {
    const lineage = vi.spyOn(api, 'memberDashboardLineage').mockResolvedValue(LINEAGE)
    renderWithProviders(<Host />)
    pick({ path: 'accepted' })
    expect(await screen.findByTestId('lineage-popover')).toBeInTheDocument()
    expect(lineage).toHaveBeenCalledWith('atlas', 'Atlas', 'accepted')
    expect(await screen.findByTestId('lineage-value')).toHaveTextContent('7')
    expect(screen.getByTestId('lineage-hop-crew_log')).toHaveTextContent('entry seq on fold rows')
    // A folded value: Edit offers "change how it's shown"; a hand correction is greyed.
    fireEvent.click(screen.getByTestId('lineage-edit-open'))
    expect(screen.getByTestId('lineage-ask')).toBeInTheDocument()
    expect(screen.getByTestId('lineage-correct-greyed')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByTestId('lineage-correct')).toBeNull()
  })

  it('pins the popover while Edit is open, and Esc closes Edit before the popover', async () => {
    vi.spyOn(api, 'memberDashboardLineage').mockResolvedValue(LINEAGE)
    renderWithProviders(<Host />)
    pick({ path: 'accepted' })
    await screen.findByTestId('lineage-value')
    fireEvent.keyDown(window, { key: 'e' })
    expect(await screen.findByTestId('lineage-edit-menu')).toBeInTheDocument()
    // Another value under the pointer does not replace a pinned popover.
    pick({ path: 'verdict' })
    pick({ path: null, rect: null })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(screen.getByTestId('lineage-edit-menu')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('lineage-edit-menu')).toBeNull()
    expect(screen.getByTestId('lineage-popover')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('lineage-popover')).toBeNull()
  })

  it("asks before it runs a script's job", async () => {
    vi.spyOn(api, 'memberDashboardLineage').mockResolvedValue({
      ...LINEAGE,
      kind: 'custom',
      hops: [{ kind: 'freshness', max_age_s: 600, stale_after: '', by: 'script' }],
      edit: { kind: 'source', writer: 'cron:p99', job: 'p99' },
    })
    vi.spyOn(api, 'crons').mockResolvedValue({ jobs: [] })
    const run = vi.spyOn(api, 'runCron').mockResolvedValue({ ok: true })
    renderWithProviders(<Host />)
    pick({ path: 'accepted' })
    fireEvent.click(await screen.findByTestId('lineage-edit-open'))
    fireEvent.click(screen.getByTestId('lineage-source'))
    fireEvent.click(await screen.findByTestId('lineage-run'))
    expect(run).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('lineage-run-yes'))
    await waitFor(() => expect(run).toHaveBeenCalledWith('p99'))
  })

  it('flips a component and sends the request only on the person\'s Send', async () => {
    const onSend = vi.fn().mockResolvedValue(true)
    renderWithProviders(<Host onSend={onSend} />)
    vi.spyOn(api, 'memberDashboardLineage').mockResolvedValue(LINEAGE)
    pick({ path: 'accepted', block: 'tasks', blockRect: { x: 0, y: 0, w: 300, h: 200 }, blockFields: ['accepted', 'verdict', 'undeclared'] })
    fireEvent.click(screen.getByTestId('dashboard-edit-capture'))
    const provider = await screen.findByTestId('dashboard-edit-provider')
    expect(provider).toHaveTextContent('accepted')
    expect(provider).toHaveTextContent('verdict')
    expect(provider).not.toHaveTextContent('undeclared')
    expect(onSend).not.toHaveBeenCalled()
    fireEvent.change(screen.getByTestId('dashboard-edit-comment'), { target: { value: 'show CI state' } })
    fireEvent.click(screen.getByTestId('dashboard-edit-send'))
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1))
    expect(onSend.mock.calls[0][0]).toBe('show CI state\n\n[Dashboard change request · board project-report · component tasks · field accepted · page v14]')
  })
})
