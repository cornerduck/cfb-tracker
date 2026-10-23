import { useCallback, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { deleteMockDraft, fetchMockDrafts, saveMockDraft, type MockDraftRow } from '../../data/queries'

type Op = { type: 'save'; mock: MockDraftRow } | { type: 'delete'; id: string }

// All mocks of the account live in one query. Changes show at once and are
// sent one after the other, so a quick pick can never overwrite a later one.
export function useMockDrafts() {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['mock-drafts'], queryFn: fetchMockDrafts, staleTime: 60_000 })
  const [error, setError] = useState<string | null>(null)
  const queue = useRef<Op[]>([])
  const running = useRef(false)

  const flush = useCallback(async () => {
    if (running.current) return
    running.current = true
    try {
      while (queue.current.length) {
        const op = queue.current.shift()!
        if (op.type === 'save') await saveMockDraft(op.mock)
        else await deleteMockDraft(op.id)
      }
      setError(null)
    } catch (failure) {
      queue.current = []
      setError(failure instanceof Error ? failure.message : 'The mock could not be saved.')
      void queryClient.invalidateQueries({ queryKey: ['mock-drafts'] })
    } finally {
      running.current = false
    }
  }, [queryClient])

  const save = useCallback((mock: MockDraftRow) => {
    queryClient.setQueryData<MockDraftRow[]>(['mock-drafts'], (old) => [mock, ...(old ?? []).filter((row) => row.id !== mock.id)])
    const waiting = queue.current.findIndex((op) => op.type === 'save' && op.mock.id === mock.id)
    if (waiting >= 0) queue.current[waiting] = { type: 'save', mock }
    else queue.current.push({ type: 'save', mock })
    void flush()
  }, [queryClient, flush])

  const remove = useCallback((id: string) => {
    queryClient.setQueryData<MockDraftRow[]>(['mock-drafts'], (old) => (old ?? []).filter((row) => row.id !== id))
    queue.current = queue.current.filter((op) => !(op.type === 'save' && op.mock.id === id))
    queue.current.push({ type: 'delete', id })
    void flush()
  }, [queryClient, flush])

  return { query, mocks: query.data, save, remove, error, clearError: () => setError(null) }
}
