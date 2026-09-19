import { Outlet } from '@tanstack/react-router'

export function RootLayout() {
  return (
    <div className="min-h-dvh bg-background text-foreground antialiased">
      <Outlet />
    </div>
  )
}
