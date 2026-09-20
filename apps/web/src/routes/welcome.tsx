import { GROUP_NAME_MAX_LENGTH, MEMBER_DISPLAY_NAME_MAX_LENGTH } from '@bakihai/shared'
import { useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { defaultRelayUrl } from '../config'
import { createGroupIdentity } from '../identity/identity'

/** First run: name the Group and pick the name the others will see. */
export function WelcomePage() {
  const navigate = useNavigate()
  const [groupName, setGroupName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const canSubmit = groupName.trim().length > 0 && displayName.trim().length > 0 && !submitting

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      await createGroupIdentity({ groupName, displayName, relayUrl: defaultRelayUrl() })
      await navigate({ to: '/' })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the Group')
      setSubmitting(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 p-6">
      <header className="flex flex-col gap-2 text-center">
        <h1 className="font-semibold text-3xl tracking-tight">BakiHai</h1>
        <p className="text-muted-foreground">A shared book for who owes what.</p>
      </header>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <h2 className="font-semibold text-xl">Create your group</h2>
        <label className="flex flex-col gap-1 text-sm">
          Group name
          <input
            name="groupName"
            value={groupName}
            onChange={(event) => setGroupName(event.target.value)}
            maxLength={GROUP_NAME_MAX_LENGTH}
            autoComplete="off"
            required
            className="rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-base"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Your name
          <input
            name="displayName"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            maxLength={MEMBER_DISPLAY_NAME_MAX_LENGTH}
            autoComplete="off"
            required
            className="rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-base"
          />
        </label>
        {error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-md bg-foreground px-4 py-2 font-medium text-background disabled:opacity-50"
        >
          {submitting ? 'Creating…' : 'Create group'}
        </button>
      </form>
    </main>
  )
}
