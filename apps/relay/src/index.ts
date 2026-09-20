import { routePartykitRequest } from 'partyserver'
import { BookRoom } from './book-room'

export { BookRoom }

export interface Env {
  BookRoom: DurableObjectNamespace<BookRoom>
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url)

    if (pathname === '/health') {
      return Response.json({ status: 'ok', service: 'bakihai-relay' })
    }

    const routed = await routePartykitRequest(request, env)

    if (routed) {
      return routed
    }

    return Response.json({ error: 'not_found' }, { status: 404 })
  },
} satisfies ExportedHandler<Env>
