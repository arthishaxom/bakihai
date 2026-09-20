import { type Invite, MEMBER_DISPLAY_NAME_MAX_LENGTH, readInviteFromHash } from '@bakihai/shared'
import { Link, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { joinGroupIdentity } from '../identity/identity'

/** Opens from an invite link: name yourself and join the Group in one step. */
export function JoinPage() {
  const [invite] = useState(() => readInviteFromHash(window.location.hash))

  if (!invite) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6 text-center">
        <h1 className="font-semibold text-2xl tracking-tight">Invite not found</h1>
        <p className="text-muted-foreground">
          This invite link is not valid. Ask a Member of the book for a fresh link.
        </p>
        <Link to="/welcome" className="underline">
          Go to BakiHai
        </Link>
      </main>
    )
  }

  return <JoinForm invite={invite} />
}

function JoinForm({ invite }: { invite: Invite }) {
  const navigate = useNavigate()
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const canSubmit = displayName.trim().length > 0 && !submitting

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      await joinGroupIdentity(invite, displayName)
      await navigate({ to: '/' })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not join the Group')
      setSubmitting(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 p-6">
      <header className="flex flex-col gap-2 text-center">
        <p className="text-muted-foreground text-sm">You are joining</p>
        <h1 className="font-semibold text-3xl tracking-tight">{invite.name}</h1>
      </header>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
          {submitting ? 'Joining…' : 'Join group'}
        </button>
      </form>
    </main>
  )
}
