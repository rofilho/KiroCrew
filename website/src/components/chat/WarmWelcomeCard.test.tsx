import { describe, it, expect, vi } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, act, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ChatMessage } from '../../types'
import type { RootState } from '../../store'
import dashboardReducer, { sseSlots } from '../../store/dashboardSlice'
import { crewBoardQueryKey } from '../../api/crewBoard'

vi.mock('../MarkdownRenderer', async (orig) => ({
  ...(await orig<typeof import('../MarkdownRenderer')>()),
  default: ({ content }: { content: string }) => <span data-testid="md">{content}</span>,
}))

import WarmWelcomeCard, { warmWelcomeOf, warmWelcomeVisibleText } from './WarmWelcomeCard'

const row = (brief: Record<string, unknown>): ChatMessage =>
  ({ role: 'assistant', content: '', meta: { kind: 'warm_task_brief_result', brief } }) as unknown as ChatMessage

const ITEM = 'it_00000001'
const BRIEF = {
  version: 4,
  count_line: 'Waiting on you: 1',
  framing: '',
  cards: [{
    kind: 'item',
    item_id: ITEM,
    title: 'Pick the layout',
    tags: [{ text: 'conflicts', bad: true }, { text: 'open', bad: false }],
    pr: { label: 'acme/w#7', url: 'https://github.com/acme/w/pull/7' },
    read: 'GitHub 06:00',
    said: {
      by: 'Conductor at 05:30:', why: 'Only you know.', pick: 'One column', pick_why: 'fits 320 px', pick_label: "Conductor's pick",
      options: [{ label: 'Two columns', outcome: 'wide screens' }, { label: 'One column', outcome: '' }],
    },
  }],
  changes_title: 'Since you left',
  changes: [{ text: 'Item 2', tags: [{ text: 'blocked', bad: true }], source: 'worker report 05:02' }],
  more: '+2 more on the Board',
  checks: [],
  board: { text: 'Board: 1 waiting on you', link: 'Open the Board →', conductor: 'crew-a' },
  body: '',
}
const SLOT = 'crew-a'

function setup(brief: Record<string, unknown> = BRIEF, awaits?: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (awaits !== undefined) qc.setQueryData(crewBoardQueryKey(SLOT), { items: [{ item_id: ITEM, awaits_person: awaits }] })
  const store = configureStore({
    reducer: { dashboard: dashboardReducer },
    preloadedState: { dashboard: { slots: [{ key: SLOT, messages: 1, running: false, needs_input: true }] } as unknown as RootState['dashboard'] },
  })
  const wrap = (node: ReactNode) => (
    <Provider store={store}><QueryClientProvider client={qc}><MemoryRouter>{node}</MemoryRouter></QueryClientProvider></Provider>
  )
  const view = render(wrap(<WarmWelcomeCard welcome={warmWelcomeOf(row(brief))!} slotKey={SLOT} />))
  return { qc, store, view }
}

describe('WarmWelcomeCard', () => {
  it('reads only a version 4 welcome', () => {
    expect(warmWelcomeOf(row({ ...BRIEF, version: 3 }))).toBeNull()
    expect(warmWelcomeOf(row({ ...BRIEF, count_line: '' }))).toBeNull()
    expect(warmWelcomeOf(row(BRIEF))?.cards[0].itemId).toBe(ITEM)
  })

  it('draws a PR pill only for a GitHub pull-request URL', () => {
    const bad = { ...BRIEF, cards: [{ ...BRIEF.cards[0], pr: { label: 'x', url: 'https://evil.example/pull/7' } }] }
    expect(warmWelcomeOf(row(bad))?.cards[0].pr).toBeNull()
  })

  it("shows the gateway's facts and the conductor's words with their time", () => {
    setup(BRIEF, true)
    expect(screen.getByTestId('warm-welcome-count')).toHaveTextContent('Waiting on you: 1Pick the layout')
    expect(screen.getByText('conflicts')).toHaveAttribute('data-bad', 'true')
    expect(screen.getByText(/Conductor at 05:30:/)).toBeInTheDocument()
    expect(screen.getByTestId('warm-welcome-changes')).toHaveTextContent('+2 more on the Board')
    expect(screen.getByRole('link', { name: 'Open the Board →' })).toHaveAttribute('href', '/crew-board?conductor=crew-a')
    expect(warmWelcomeVisibleText(warmWelcomeOf(row(BRIEF))!)).toContain('One column ★')
  })

  it('hides a card already answered while the welcome was being written', () => {
    // The Board's live value says the item no longer waits: dismissed during render.
    setup(BRIEF, false)
    expect(screen.queryByText('Pick the layout')).toBeNull()
    expect(screen.queryByText('Two columns')).toBeNull()
  })

  it('hides a card, and its options, once its item stops waiting after posting', async () => {
    const { qc } = setup(BRIEF, true)
    expect(screen.getAllByText('Pick the layout').length).toBeGreaterThan(0)
    act(() => { qc.setQueryData(crewBoardQueryKey(SLOT), { items: [{ item_id: ITEM, awaits_person: false }] }) })
    await waitFor(() => expect(screen.queryByText('Two columns')).toBeNull())
    expect(screen.queryByText('Pick the layout')).toBeNull()
  })

  it('hides a question card once the slot no longer needs input', async () => {
    const q = { ...BRIEF, cards: [{ kind: 'question', title: 'Which tea?', tags: [], options: ['Oolong'] }] }
    const { store } = setup(q)
    expect(screen.getAllByText('Which tea?').length).toBeGreaterThan(0)
    act(() => { store.dispatch(sseSlots([{ key: SLOT, messages: 1, running: false, needs_input: false }] as Parameters<typeof sseSlots>[0])) })
    await waitFor(() => expect(screen.queryByText('Oolong')).toBeNull())
  })
})
