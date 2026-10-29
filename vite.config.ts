import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/** Serves the Vercel functions in api/ during `npm run dev`. */
function apiRoutes(): Plugin {
  return {
    name: 'api-routes',
    configureServer(server) {
      for (const name of ['playlist', 'deezer']) {
        server.middlewares.use(`/api/${name}`, async (req, res) => {
          const { GET } = await server.ssrLoadModule(`/api/${name}.js`)
          // Connect strips the mount path, so only the query is left on the request
          const url = (req as { url?: string }).url ?? ''
          const query = url.includes('?') ? url.slice(url.indexOf('?')) : ''
          const reply: Response = await GET(new Request(`http://localhost/api/${name}${query}`))
          res.statusCode = reply.status
          reply.headers.forEach((value, key) => res.setHeader(key, value))
          res.end(await reply.text())
        })
      }
    },
  }
}

export default defineConfig({ plugins: [react(), apiRoutes()] })
