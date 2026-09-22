import { GROUP_NAME_MAX_LENGTH, readInviteFromHash } from '@bakihai/shared'
import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router'
import { loadIdentity } from './identity/identity'
import { BookPage } from './routes/book'
import { JoinPage } from './routes/join'
import { RootLayout } from './routes/root'
import { WelcomePage } from './routes/welcome'

const rootRoute = createRootRoute({ component: RootLayout })

/**
 * The book screen's search params. A phone that already has a book and opens an
 * invite for another Group lands with `inviteFor` set, naming the Group the
 * invite was for so the bounce explains itself. The param is display-only: it
 * never switches the book or touches identity, and P2 keeps one Group per
 * install (multi-group travels with P3).
 */
interface BookSearch {
  inviteFor?: string
}

/** Reads `inviteFor`, dropping anything that cannot be a Group name. */
function parseBookSearch(search: Record<string, unknown>): BookSearch {
  const inviteFor = search.inviteFor

  if (typeof inviteFor !== 'string') {
    return {}
  }

  const name = inviteFor.trim()

  return name.length > 0 && name.length <= GROUP_NAME_MAX_LENGTH ? { inviteFor: name } : {}
}

/** The Group's book; a first run has nothing to show, so it creates one instead. */
const bookRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  validateSearch: parseBookSearch,
  beforeLoad: () => {
    if (!loadIdentity()) {
      throw redirect({ to: '/welcome' })
    }
  },
  component: BookPage,
})

/**
 * Onboarding screens make no sense on a device that already has a Group: they
 * send it back to its own book. An invite for another Group rides along as a
 * notice naming that Group, so the bounce is explained rather than silent; an
 * invite for this Group (or an unreadable one) changes nothing.
 */
function sendOnboardedDevicesHome({ location }: { location: { hash: string } }): void {
  const identity = loadIdentity()

  if (!identity) {
    return
  }

  const invite = readInviteFromHash(location.hash)

  if (invite && invite.room !== identity.groupId) {
    throw redirect({ to: '/', search: { inviteFor: invite.name } })
  }

  throw redirect({ to: '/' })
}

const welcomeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/welcome',
  beforeLoad: sendOnboardedDevicesHome,
  component: WelcomePage,
})

/** The invite link's landing page; the Group secret stays in the URL fragment. */
const joinRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/join',
  beforeLoad: sendOnboardedDevicesHome,
  component: JoinPage,
})

const routeTree = rootRoute.addChildren([bookRoute, welcomeRoute, joinRoute])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
