import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router'
import { loadIdentity } from './identity/identity'
import { BookPage } from './routes/book'
import { JoinPage } from './routes/join'
import { RootLayout } from './routes/root'
import { WelcomePage } from './routes/welcome'

const rootRoute = createRootRoute({ component: RootLayout })

/** The Group's book; a first run has nothing to show, so it creates one instead. */
const bookRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    if (!loadIdentity()) {
      throw redirect({ to: '/welcome' })
    }
  },
  component: BookPage,
})

/** Onboarding screens make no sense on a device that already has a Group. */
function sendOnboardedDevicesHome(): void {
  if (loadIdentity()) {
    throw redirect({ to: '/' })
  }
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
